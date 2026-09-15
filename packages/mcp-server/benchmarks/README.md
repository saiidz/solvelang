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

## Independent external source subsets

Run `npm run eval:context:independent` from `packages/mcp-server`. The suite uses two
separately pinned MIT repositories rather than SolveLang itself:

- `chalk/chalk` at `661317e6f91fe7c90306c2c48ea9354562ee9146`, with the complete pinned
  `source/index.js` and `source/utilities.js` files.
- `node-fetch/node-fetch` at `8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f`, with the complete pinned
  `src/response.js`, `src/body.js`, and `src/headers.js` files.

The checked-in MIT notices are retained beside the corpora. Snapshot filenames are
the reviewed upstream Git blob SHA-1 values, `*.txt -text` prevents checkout newline
conversion, and each offline run recomputes the Git blob identity before deriving a
SHA-256 used by the existing integrity and excerpt-provenance checks. The runner has
no arbitrary path or URL input, performs no network calls, and never executes the
captured source.

Four dependency-oriented tasks exercise Chalk multiline/closed-style helpers and
node-fetch response cloning/content-type/header flows. They reuse the same equal-byte
lexical, changed-path, and graph-assisted arms and the same non-regression contract as
the first-party corpus. These are independent external source subsets, not complete
repository measurements. Their annotations are checked in and visible to the
implementation, so they are not a blinded holdout.

## Limits and remaining proof

The first-party regression corpus plus the two external subsets improve coverage but
do not constitute a whole-repository benchmark, a blinded held-out evaluation, or a
completed Claude/Codex coding task. Provider input/output tokens, cache reuse,
task-success rates, and competitor results remain unmeasured and are reported as
null/false, never estimated from byte reduction. The serialized pack can be larger
than the source excerpts; do not advertise excerpt reductions as wire-size or token
savings. Timing varies and is not end-to-end agent latency.

Issue #898 still needs broader/larger independently pinned or blinded evaluation,
real agent-task quality and token/cache measurements, and distribution proof before
public savings or comparative-performance claims. These suites grant no provider
credential, network, billing, deployment, publication, or Solve Runner authority.
