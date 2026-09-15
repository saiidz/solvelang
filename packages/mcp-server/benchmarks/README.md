# Solve Context evaluation evidence

## Synthetic baseline

`npm run eval:context` retains the existing synthetic selection and handoff suite.
It measures excerpt bytes and evidence proxies, not provider tokens or agent success.

## Pinned real-source regression suite

Run `npm run eval:context:repository` from `packages/mcp-server`.
MCP CI runs this command in addition to the existing package, synthetic, protocol,
and packed-consumer checks.

The manifest `context-repository-v1.json` records six complete source files from
`saiidz/solvelang` at `c36f2b18e3393b8174943e01b79d56c65ce83c58` (MIT).
The corresponding `repository-snapshots/<git-blob-sha1>.txt` files preserve their
exact UTF-8 bytes. Each source was checked against GitHub at capture; offline runs
recompute both Git blob SHA-1 and SHA-256 and reject byte drift. These hashes verify
the captured bytes; they do not independently attest the remote repository/commit.
Snapshots are data, never executed or loaded as modules, and are excluded from the
published npm package by the existing package allowlist. Do not update a snapshot
just because its live source evolves: this is intentionally a fixed regression corpus.
A replacement corpus requires a reviewed new pin, hashes, and evidence annotations.

Four manually authored tasks cover JSON-LD escape safety, rendering dependencies,
remote CLI failure diagnosis, and context path validation. Each runs three arms at
the same byte budget: lexical-only, changed-path hints, and changed-path plus one-hop
graph hints. The graph contains only literal relative imports found in the fixed
subset; missing import targets are counted, not guessed. This is not a general
TypeScript parser or complete repository graph.

The path-boundary case exposed a concrete limitation: a dependency with no task-word
match previously contributed only its first nine lines, omitting the normalizer's
traversal check. Selection-only fallback now anchors bounded windows at exported
function/class declaration text. Windows are at most 24 lines, never overlap the
next declaration, retain exact ranges/hashes, and obey the original byte budget.
They are textual hints, not semantic parsing or proof that a full body was included.
Ordinary lexical matching and non-declaration header fallback remain unchanged.

Reports include exact evidence recall, path precision/recall proxies, deterministic
pack identities, source/excerpt integrity, budget/omission truth, excerpt bytes,
serialized pack bytes including metadata, and one local pack-construction timing.
A case fails on missing required evidence or graph-assisted evidence regression
against either baseline. Lower byte counts alone cannot make a case pass.

## Limits and remaining proof

This is one small first-party source subset, not a whole-repository benchmark, a
held-out evaluation, or a completed Claude/Codex coding task. Its annotations and
regression expectations are visible to the implementation. Provider input/output
tokens, cache reuse, task-success rates, and competitor results remain unmeasured
and are reported as null/false, never estimated from byte reduction. The serialized
pack can be larger than the source excerpts; do not advertise excerpt reductions
as wire-size or token savings. Timing varies and is not end-to-end agent latency.

Issue #898 still needs larger independent pinned repositories, real agent-task
quality and token/cache measurements, and distribution proof before public savings
or comparative-performance claims. This suite grants no provider credential,
network, billing, deployment, publication, or Solve Runner authority.
