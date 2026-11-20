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

## One protocol, two hops

The wire protocol is the bus protocol, unchanged: the relay imports the
bus envelope module (`packages/mcp-server/src/bus-envelope.ts`) — the
same envelope shape (`solvelang.bus.message.v1`), the same content-hash
ids (`sch_<sha256>` over the canonical core), the same signature
payload, the same refusal codes (`bus_*`), and the same Phase 4 key
registry — so the local daemon hop and the hosted relay hop cannot
drift apart. Claim semantics are the daemon's too: atomic grant/deny at
claim time, TTL leases (default 30 s, max 10 min), expiry frees the item
and is audit-logged and broadcast as a `claim_expired` system signal
from the `daemon` sender, and claim + presence state is recoverable
from the append-only audit log after a restart (messages are signals
and are never replayed).

What the hosted hop adds is transport and tenancy: HTTP with long-poll
delivery instead of local sockets, and **workspaces**.

## Deployment state

**Live since Nov 20, 2026** at `https://relay.solve-lang.com` — a
dedicated container (`solvelang-relay`) on the SolveLang production
host, deployed from this repository at the Phase 6 reconciliation merge
under the owner's explicit production approval, with the host's TLS
reverse proxy as the public ingress (Let's Encrypt) and DNS on the
solve-lang.com zone. Verified end-to-end from outside the host before
being called live: two independent clients coordinating (claim denied
at claim time for the contender, signed signal delivered, presence
readable), authenticity refusals (`bus_unsigned`,
`bus_signature_invalid`, `bus_signer_revoked`) never delivered,
workspace isolation, the rate limiter answering 429 at its bound, and a
kill-switch cycle — relay stopped, clients coordinating via document
handoffs, relay restarted, service recovered. Operations: the config
and sealed credentials live on the host in the deploy directory
(`/root/solvelang-relay-deploy/`, mode 600, never in git); stop or
start with `docker stop solvelang-relay` / `docker start
solvelang-relay`; full removal is the container plus the
`relay-solve-lang.yaml` proxy file plus the DNS record.

## Routes

| Route | Meaning |
|---|---|
| `GET /healthz` | Liveness. Open, never rate-limited. |
| `POST /relay/messages` | Publish one bus envelope. Returns its stream `seq`; a repost of the same `id` returns `duplicate: true` and delivers nothing twice. |
| `GET /relay/messages?since=<seq>&waitMs=<ms>` | Long-poll delivery for the caller's agent (addressed + `*` broadcast), at-least-once; consumers dedupe by `id`. |
| `POST /relay/claims` `{item, ttlMs?}` | Atomic claim: `{granted: true}` or `{granted: false, holder}` — decided at claim time, never at merge time. |
| `POST /relay/claims/release` `{item}` | Release; only the holder can release. Broadcasts a `claim_released` signal. |
| `GET /relay/claims` | The workspace's live claims. |
| `GET /relay/presence?agent=<name>` | `{lastSeen, silentMs}` for an agent in the caller's workspace. |
| `POST /relay/presence` | Heartbeat. (Any authenticated request also refreshes presence.) |

Every message, refusal, and claim event is appended to the relay's
append-only audit log (JSONL) — the log is the record of what was
relayed, and the recovery source for claim state.

## Authentication and isolation

- Every route except `/healthz` requires a bearer token. A token binds
  exactly one **(workspace, agent)** pair; the server stores only the
  token's SHA-256 hash and compares timing-safe. The envelope's
  `fromAgent` must equal the token's agent (`bus_sender_mismatch`).
- Workspaces are fully isolated: no route can observe another
  workspace's messages, claims, or presence.
- A fixed-window rate limiter (default 300 requests / 60 s per source,
  configurable via `SOLVELANG_RELAY_RATE_LIMIT` /
  `SOLVELANG_RELAY_RATE_WINDOW_MS`) is enforced **before**
  authentication, answering `429` with `Retry-After`. Requests are
  bounded at 256 KiB (`413`).

## Authenticity — signatures are real here

The local bus has two modes: `local-open` (integrity only, localhost)
and `registry` (every message signed). A workspace maps onto the same
choice via `requireSignatures`:

- `requireSignatures: true` (the default): the workspace carries a
  `solvelang.key-registry` v1 document — the Phase 4 registry format,
  public keys only, revocation is a status flip to `revoked` — and
  every message is verified with the bus module's `verifyBusMessage`.
  Unsigned → `bus_unsigned`; unknown signer → `bus_unknown_signer`;
  revoked signer → `bus_signer_revoked`; bad signature →
  `bus_signature_invalid`. A refused message is never relayed, and the
  refusal is audit-logged.
- `requireSignatures: false`: unsigned messages are accepted, but a
  message that **carries** a signature is still verified — a
  presented-but-bad signature is never relayed on the theory it was
  optional.

The signature itself is the bus's: `signer` names the Phase 4 key id,
`sig` is the base64 Ed25519 signature over the canonical payload
(version line, then `id` / `from` / `to` / `kind` / `ts` /
`body-sha256` / `ref` / `signer` lines). A keypair made for signed
gates (`solvec keygen`) signs relay messages unchanged.

Claim and presence calls carry no envelope; on this hop they are
authenticated by the bearer token itself, which is the agent's
credential. (The local daemon, which has no per-agent credential
channel, verifies a signed envelope attached to the claim instead. The
claim *semantics* — atomicity, leases, signals — are identical.)

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

Message state is in-memory per workspace by design. Signals are
ephemeral: a relay restart loses undelivered signals, but no truth —
handoff documents were always the record. Live claims and presence
survive a restart via audit-log recovery; a lease that lapsed while
the relay was down recovers as free. Retention is the last 1,000
messages per workspace for long-poll catch-up; the audit log is the
durable trail.

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
