# SolveLang Hosted Relay

The hosted relay is the cross-machine counterpart of the Phase 6 local
bus: a small stateful service that carries **signals** between agents
working in the same workspace on different machines. It exists because
the spike (see `solvelang-phase6-spike-verdict-2026-11-20.md` in the
project records) proved the bus's value is contention timing — conflicts
surface at claim time instead of merge time — and the local daemon
cannot cross machines.

The split from the design is unchanged: **the bus carries signals;
documents carry truth.** Anything that matters still lands as a
content-addressed handoff document; a relay message points at it via
`ref` and is worthless as evidence on its own.

## Protocol

Plain JSON over HTTPS. The envelope is the handoff schema extended
(design §3.1), byte-identical in identity to the local bus: `id` is
`sch_<sha256>` over the canonical core `{fromAgent, toAgent, kind,
body, ref}`; kinds are `signal`, `claim`, `release`, `propose`,
`accept`, `reject`, `ping`, `pong`.

| Route | Meaning |
|---|---|
| `GET /healthz` | Liveness. Open, never rate-limited. |
| `POST /relay/messages` | Publish one envelope. Returns its stream `seq`; a repost of the same `id` returns `duplicate: true` and delivers nothing twice. |
| `GET /relay/messages?since=<seq>&waitMs=<ms>` | Long-poll delivery for the caller's agent (addressed + `*` broadcast), at-least-once; consumers dedupe by `id`. |
| `POST /relay/claims` `{item, ttlMs?}` | Atomic claim: `{granted: true}` or `{granted: false, holder}` — decided at claim time, never at merge time. |
| `POST /relay/claims/release` `{item}` | Release; only the holder can release. Broadcasts a `claim_released` signal. |
| `GET /relay/claims` | The workspace's live claims. |
| `GET /relay/presence?agent=<name>` | `{lastSeen, silentMs}` for an agent in the caller's workspace. |
| `POST /relay/presence` | Heartbeat. (Any authenticated request also refreshes presence.) |

Claims carry leases (default TTL 8 s, bounds 250 ms – 300 s). An expired
lease frees the item, is written to the audit log, and is broadcast as a
`claim_expired` signal. Every message, refusal, and claim event is
appended to the relay's append-only audit log (JSONL) — the log is the
record of what was relayed.

## Authentication and isolation

- Every route except `/healthz` requires a bearer token. A token binds
  exactly one **(workspace, agent)** pair; the server stores only the
  token's SHA-256 hash and compares timing-safe. `fromAgent` must equal
  the token's agent.
- Workspaces are fully isolated: no route can observe another
  workspace's messages, claims, or presence.
- A fixed-window rate limiter (default 300 requests / 60 s per source)
  is enforced **before** authentication, answering `429` with
  `Retry-After`. Requests are bounded at 256 KiB (`413`).

## Authenticity — signatures are real here

The local bus inherits the handoff trust model (integrity, no proof of
sender). The hosted relay is the cross-machine hop, so the envelope's
reserved `sig` field carries a Phase 4-style Ed25519 signature:

```
sig = "ed25519:<key-id>:<base64 signature>"
payload = "solvelang-bus-signature-v1\nid:<id>\nfrom:<from>\nto:<to>\nkind:<kind>\nsigner:<key-id>\n"
```

Workspace key registries use the Phase 4 registry JSON shape (public
keys only; revocation is a status flip to `revoked`). A workspace with
`requireSignatures: true` refuses unsigned messages
(`signature_required`). A presented signature that fails verification
is refused in **every** workspace: `signature_malformed`,
`unknown_signer`, `signer_revoked`, or `signature_invalid`. A refused
message is never relayed, and the refusal is audit-logged. Claim and
presence calls are authenticated by the bearer token itself (the token
is the agent's credential); envelope signatures protect the relayed
message stream.

## Hosting shape

A dedicated container on the SolveLang production host (the Phase 5
remote-endpoint pattern): `packages/mcp-server/Dockerfile.relay` +
`deploy/docker-compose.relay.yml`, binding `127.0.0.1:8788` on the host
with the host's TLS reverse proxy as the single public ingress for
`relay.solve-lang.com`. The relay config (token hashes + key
registries) is a host-held file mounted read-only; the audit log lives
on a host volume. The service is deliberately **not** on the Lambda/API
surface: claims, presence, and long-poll waits are stateful, and a
request-scoped runtime cannot hold them honestly.

State is in-memory per workspace by design. Signals are ephemeral: a
relay restart loses undelivered signals and live claims, but no truth —
handoff documents were always the record, and clients re-claim after a
restart. Retention is the last 1,000 messages per workspace for
long-poll catch-up; the audit log is the durable trail.

## Kill switch

The relay is an add-on. Stop the container (and, for a full public
removal, its proxy route + DNS record) and every client falls back to
pure document handoffs with no state loss — the degradation the spike
verified against the local daemon. Nothing in the framework requires
the relay to be up.

## Limits, stated plainly

- Per-source rate limiting keys on the first `X-Forwarded-For` hop
  behind the host proxy; edge limiting at the proxy/CDN is still
  required, as with the remote MCP endpoint.
- A signature attests that the holder of a registered key signed this
  envelope; it does not make the envelope's contents true.
- Cross-workspace coordination is impossible by design; two workspaces
  that must coordinate need a shared workspace and its own tokens/keys.
