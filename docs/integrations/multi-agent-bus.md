# Multi-agent bus

The bus is SolveLang's live coordination layer for agents working
in the same workspace: presence, low-latency signals, and work
claims that surface contention **at claim time** instead of at merge
time. It was adopted on measured evidence (the Phase 6 spike:
document-only handoffs produced 2 late conflicts per run on a
two-agent workload; handoffs + bus produced 0, with no correctness
loss) — not on the promise of raw speed, which the spike did not
establish (22.9% faster against a 25% bar).

One rule governs the whole design:

> **The bus carries signals; documents carry truth.**

Anything that matters — decisions, diffs, evidence — still lands as
a durable, content-addressed handoff document. The bus can be
killed at any moment and the system degrades to exactly the
document-handoff pattern, with no state loss. The bus is an add-on,
never the record.

## Quickstart

```bash
# Start the workspace daemon (detached, supervised):
solvelang-bus start --workspace /path/to/project

# With sender authenticity (recommended beyond one trusted desktop):
solvelang-bus start --workspace /path/to/project --keys solve-keys.json

solvelang-bus status --workspace /path/to/project
solvelang-bus stop   --workspace /path/to/project
```

Agents connect with the client library (`BusClient` in
`@solvelang/mcp-server`'s `bus-client` module), naming themselves
exactly as their handoff documents do. The daemon binds
**127.0.0.1 only**; there is no hosted relay and no cross-machine
mode in this version (see *Honest limits*).

## The envelope

A bus message is the handoff schema, extended for live transport:

```json
{
  "schema": "solvelang.bus.message.v1",
  "id": "sch_<sha256>",
  "fromAgent": "claude",
  "toAgent": "codex",
  "kind": "signal",
  "ts": 1795195671496,
  "body": { "step": "A1" },
  "ref": "sch_<handoff document id>",
  "signer": "producer_key",
  "sig": "<base64 Ed25519 signature>"
}
```

- `id` is the content hash (`sch_<sha256>`) of the message core —
  **integrity, not authenticity**. It also makes consumers
  idempotent: delivery is at-least-once, and duplicates collapse
  by id.
- `kind` is one of `signal`, `claim`, `release`, `propose`,
  `accept`, `reject`, `ping`, `pong`.
- `ref` points at the handoff document the signal is about,
  whenever the signal carries substance.
- `signer` / `sig` carry the Phase 4 signature (below). `sig` is
  empty only in the explicitly named local-open mode.

## Claims and leases

`claim(item)` is granted or denied **atomically by the daemon**;
a denial names the current holder, and the loser waits for the
release signal instead of discovering the conflict after doing the
work. Claims carry a lease (TTL, default 30 s, renewed by the
holder re-claiming): a crashed agent's claims free themselves, and
every grant, denial, release and expiry is written to the audit
log. When the daemon is down, claims degrade to claim *documents*
— best-effort, earlier unexpired claim wins, races possible —
which is precisely the behaviour the bus exists to improve on, and
the client reports it (`viaBus: false`, `usingFallback`) rather
than hiding it.

## Presence

The daemon tracks last-seen per agent (subscription + `ping`
heartbeats). `presence(agent)` answers "last seen at / silent for
how long" — the question a producing agent otherwise answers by
polling its peer's inbox.

## Signing: the `sig` field

Bus messages reuse Phase 4's key world unchanged — the same
`solvelang.key-registry` v1 registry, the same
`solvelang.private-key` v1 signer files, the same Ed25519
signatures (see [signed gates](../signed-gates.md)). A keypair made
by `solvec keygen` for gates signs bus messages with no conversion.
The signature covers one canonical record in the gate style:

```text
solvelang-bus-signature-v1
id:sch_<...>
from:<agent>
to:<agent>
kind:<kind>
ts:<unix milliseconds>
body-sha256:<hex or ->
ref:<sch id or ->
signer:<key id>
```

Two modes, stated on the daemon's face (startup line + `status`):

- **Registry mode** (`--keys <registry.json>`): signatures are
  **required**. The daemon verifies before it relays or grants, and
  clients verify before they deliver to the agent. Failures refuse
  fail-closed with distinct codes in the gate style:
  `bus_unsigned`, `bus_unknown_signer`, `bus_signer_revoked`,
  `bus_signature_invalid`, plus `bus_sender_mismatch` (the
  connection is subscribed as a different agent than the envelope
  claims) and `bus_id_mismatch` (the content hash does not match
  the core). Every refusal is written to the audit log.
- **Local-open mode** (no registry): messages are unsigned and
  carry integrity only — **no proof of sender**. The mode is a
  deliberate, named choice for a single trusted desktop; the
  daemon announces it at startup, and it must never be used to
  coordinate across machines.

Conventions that keep the modes honest: register **one key per
agent**, with the key id naming the agent (the registry is the
trust root; revocation is the same `status: "revoked"` registry
edit as gates). Daemon-originated system signals
(`claim_released` / `claim_expired`, `fromAgent: "daemon"`) are
unsigned by construction — they originate inside the daemon
process on the same machine, carry no substance, and consumers
treat them as local control signals, never as evidence.

## Kill switch and fallback

Stopping the daemon (`solvelang-bus stop`), killing it, or never
starting it are all the same to clients: sends complete as handoff
documents, waits poll the documents, claims degrade as described
above. `BusClient.connect` itself succeeds against a dead port —
a workspace with no bus is a normal state, reported via
`client.usingFallback`, not an error.

## Lifecycle

State lives in `<workspace>/.solvelang/bus/`:

| File | What it is |
| --- | --- |
| `bus-state.json` | Pids, port, auth mode, start time — how clients and `status` find the daemon. |
| `bus.jsonl` | The daemon's append-only audit log (JSONL). |
| `bus.jsonl.1` … `.3` | Rotated audit segments, newest first. |
| `supervisor.log` | Supervisor output, including restart and give-up notices. |
| `inbox/<agent>/` | Handoff documents written by clients (the fallback transport and the record). |
| `claims/<item>/` | Document claims used while the daemon is down. |

- **Supervision:** `start` runs a detached supervisor that
  restarts the daemon after a crash, bounded at 5 restarts inside
  60 seconds; past that it gives up loudly in `supervisor.log`
  (agents continue on documents meanwhile).
- **Recovery:** on startup the daemon replays the audit log
  (segments oldest first) and restores live claims (leases that
  already lapsed recover as free) and presence last-seen. Messages
  are signals and are deliberately **not** replayed.
- **Log rotation:** the audit log rotates by size (default bound
  8 MiB per segment, 3 archives — `--max-log-bytes`,
  `--max-log-archives`). Rotation renames whole segments and never
  truncates the live segment mid-line; the trail is the
  concatenation of the segments, and each rotation is itself
  recorded in the new segment.

## Honest limits

- **Local only.** The daemon binds localhost and dies with the
  machine — acceptable because signals are ephemeral by design.
  Cross-machine coordination would need a hosted relay on the API
  surface; that is a separate, gated production decision and is
  **not** part of this build.
- **Integrity is not authenticity.** A `sch_` id proves a message
  was not altered after hashing; only a verified `sig` in registry
  mode proves who sent it, and local-open mode offers no sender
  proof at all. A signature attests that the key holder sent these
  bytes; it does not make the contents true — the same limit as
  signed gates.
- **Agent ↔ key binding is by registry convention** (one key per
  agent, registered by whoever operates the workspace). Whoever
  can edit the registry controls who is trusted — the same trust
  boundary as the code-review process that owns that file.
- **Document claims are best-effort.** The atomic guarantee exists
  only while the daemon is up; the fallback is today's behaviour,
  labelled as such.
- **Platform risk stands.** Claude Code and Codex are adding
  native multi-agent coordination. The bus's defensible niche is
  the cross-tool one — anchored to the handoff documents those
  tools already exchange through SolveLang — and it is kept small
  enough to abandon if the vendors close that gap.
