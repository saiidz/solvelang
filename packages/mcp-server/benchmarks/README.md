# Solve Context evaluation evidence

## Synthetic baseline

`npm run eval:context` retains the existing synthetic selection and handoff suite.
It measures excerpt bytes and evidence proxies, not provider tokens or agent success.
The deterministic fixtures now include bug-fix, GitHub issue-triage, CI/log diagnosis,
multi-file refactor, JSON-heavy tool output and cross-agent handoff categories. The
handoff fixture remains synthetic and one-directional; it is not evidence that both
Claude -> Codex and Codex -> Claude long-session tasks succeed end to end.

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

The external cases exposed a second bounded-selection gap: a graph-selected neighbor
could have a real lexical hit in an exported declaration or its leading JSDoc while
the fixed ±4-line lexical window still omitted later implementation evidence or the
declaration itself. For one-hop `graph:dependency:*` and `graph:dependent:*` sources
only, a lexical hit may now expand into a bounded exported declaration text window.
That expansion recognizes exported function/class declarations plus exported
`const`/`let`/`var` bindings and can include up to 16 leading comment/JSDoc lines;
the resulting window remains capped at 24 lines and stops before the next exported
declaration. Explicit changed paths retain their previous lexical/header behavior and
provenance. The benchmark budgets and required evidence were not loosened to make
these cases pass.

## Agent-run measurement records

`context-agent-eval.ts` defines a strict, content-addressed record/report contract for
future baseline-versus-Solve-Context Claude and Codex runs. It does **not** launch an
agent or contact a provider. The caller supplies records collected by a separately
authorized run, and the local harness validates and summarizes them.

A pair must use the same suite/pair fixture identity, pinned fixture revision, agent,
provider and model. Cross-agent handoff fixtures must also identify the direction as
`claude-to-codex` or `codex-to-claude`; other categories cannot set a handoff direction.
The baseline cannot claim a Solve Context pack or selection metrics. The context arm
must identify its pack and selected bytes. Task success and exact-evidence counts are
kept beside usage, latency, selection precision/recall and cache-hot mutation evidence
so a smaller context cannot hide a quality regression.

Measurement bases are intentionally distinct:

- `provider-reported` is the only token basis included in provider-token aggregates.
- `local-tokenizer` requires an explicit tokenizer label and is reported separately.
- `estimated` requires an estimator label and is never promoted to provider usage.
- `unavailable` requires null metrics rather than guessed values.
- `synthetic` is allowed only in `synthetic-test` records; those pairs are excluded
  from measured aggregates and cannot make benchmark evidence complete.

Likewise, measured wall-clock latency, selection precision/recall and cache-hot byte
evidence are kept separate from estimated, unavailable or synthetic values. A measured
safe-mode context arm must record `cacheHotBytesChanged: 0` to count toward completion;
the report does not infer zero from missing data. The quality gate fails when a context
arm loses baseline task success or exact-evidence recall even if provider-reported
input tokens fall sharply.

To summarize previously collected records, pass a JSON array on stdin:

```sh
cat approved-agent-run-records.json | npm run eval:context:agent-records
```

The command accepts no file/URL argument, reads at most 4 MiB from stdin, performs no
provider/network call and uses no credentials. `npm run test:context-agent-eval-cli`
uses synthetic-only records to verify the CLI and claim boundaries in MCP CI. Do not
commit real provider credentials, prompts containing secrets, or private customer
content as benchmark records.

`benchmarkEvidenceComplete` remains false until measured pairs satisfy **all** of the
#898 acceptance gates: every six-category fixture class is covered, both Claude and
Codex have measured pairs, both handoff directions are measured, quality does not
regress, every measured pair has provider-reported token usage and measured latency,
every Solve Context arm has measured selection precision/recall, and every safe-mode
context arm has measured `cacheHotBytesChanged: 0`. Missing/estimated/synthetic values
cannot satisfy these gates. Even a complete engineering report keeps
`publicationAuthorized: false` and `publicPercentageClaimAllowed: false`; repository
evidence is not business/publication approval.

## Limits and remaining proof

The first-party regression corpus plus the two external subsets improve coverage but
do not constitute a whole-repository benchmark, a blinded held-out evaluation, or a
completed Claude/Codex coding task. The new record/report contract makes future real
measurements comparable; it does not create those measurements. Provider input/output
tokens, cache reuse, real task-success rates and competitor results remain unmeasured
until separately authorized runs supply truthful records. Excerpt-byte reduction is
not token savings, and local timing is not end-to-end agent latency.

Issue #898 still needs broader/larger independently pinned or blinded evaluation,
actual Claude/Codex task runs including bidirectional long-session handoff, measured
quality/token/cache/selection/latency evidence, and distribution proof before public
savings or comparative-performance claims. These suites grant no provider credential,
network, billing, deployment, publication, or Solve Runner authority.
