# Solve Context evaluation evidence

Status reconciled through #922 on 2026-09-15. These are repository evaluation contracts and regression fixtures, not public provider-performance claims.

## Synthetic baseline

`npm run eval:context` retains the existing synthetic selection and handoff suite.
It measures excerpt bytes and evidence proxies, not provider tokens or agent success.
The deterministic fixtures include bug-fix, GitHub issue-triage, CI/log diagnosis,
multi-file refactor, JSON-heavy tool output and cross-agent handoff categories. The
handoff fixture remains synthetic and is not evidence that both Claude -> Codex and
Codex -> Claude long-session tasks succeed end to end.

## Pinned real-source regression suite

Run `npm run eval:context:repository` from `packages/mcp-server`.
MCP CI runs this command in addition to package tests, synthetic evals, protocol,
agent-record contract, plugin roundtrip and packed-consumer checks.

The manifest `context-repository-v1.json` records six complete source files from
`saiidz/solvelang` at `c36f2b18e3393b8174943e01b79d56c65ce83c58` (MIT).
The corresponding `repository-snapshots/<git-blob-sha1>.txt` files preserve their
exact UTF-8 bytes. Each source was checked against GitHub at capture; offline runs
recompute both Git blob SHA-1 and SHA-256 and reject byte drift. These hashes verify
the captured bytes; they do not independently attest the remote repository/commit.
Snapshots are data, never executed or loaded as modules, and are excluded from the
published npm package by the reviewed package allowlist. Do not update a snapshot
just because live source evolves: this is intentionally a fixed regression corpus.
A replacement corpus requires a reviewed new pin, hashes and evidence annotations.

Four manually authored tasks cover JSON-LD escape safety, rendering dependencies,
remote CLI failure diagnosis and context path validation. Each runs three arms at
the same byte budget: lexical-only, changed-path hints, and changed-path plus one-hop
graph hints. The graph contains only literal relative imports found in the fixed
subset; missing import targets are counted, not guessed. This is not a general
TypeScript parser or complete repository graph.

The path-boundary case exposed a concrete limitation: a dependency with no task-word
match previously contributed only its first lines, omitting the normalizer's traversal
check. Selection-only fallback now anchors bounded windows at exported declarations.
Subsequent composition work globally re-ranks exact fragments at their actual score
and preserves distinct task evidence on ties. Exact source/excerpt hashes, coordinates,
budgets and omissions remain part of the contract.

Reports include exact evidence recall, path precision/recall proxies, deterministic
pack identities, source/excerpt integrity, budget/omission truth, excerpt bytes,
serialized pack bytes including metadata, and local pack-construction timing.
A case fails on missing required evidence or graph-assisted evidence regression
against either baseline. Lower byte counts alone cannot make a case pass.

## Independent external source subsets

Run `npm run eval:context:independent` from `packages/mcp-server`. The suite now uses
three separately pinned MIT repositories rather than SolveLang itself:

- `axios/axios` at `ed95c083f574e869bfe894866d95a01825f8ff4e`, with complete pinned
  `lib/core/Axios.js`, `InterceptorManager.js`, `dispatchRequest.js`, and
  `transformData.js` files.
- `chalk/chalk` at `661317e6f91fe7c90306c2c48ea9354562ee9146`, with complete pinned
  `source/index.js` and `source/utilities.js` files.
- `node-fetch/node-fetch` at `8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f`, with complete pinned
  `src/response.js`, `src/body.js`, and `src/headers.js` files.

That is **3 repositories, 9 complete source files, and 7 fixed tasks**. #922 adds the
Axios corpus and three cross-file tasks covering request-interceptor iteration,
request-data transformation, and asynchronous interceptor-to-dispatch flow. The
existing Chalk/node-fetch tasks and their budgets/evidence requirements were not
relaxed or rewritten.

The checked-in MIT notices are retained beside the corpora. Snapshot filenames are
the reviewed upstream Git blob SHA-1 values, `*.txt -text` prevents checkout newline
conversion, and each offline run recomputes the Git blob identity before deriving a
SHA-256 used by integrity and excerpt-provenance checks. The Axios manifest stores
Git identities in bounded segments only to avoid secret-scanner false positives;
the loader reassembles them and requires the same exact 40-hex Git identities before
reading any snapshot. The runner has no arbitrary path or URL input, performs no
network calls and never executes captured source.

The #922 exact-head run passed all seven external tasks with the existing selector.
For the three Axios cases, every arm retained **100% required path recall and 100%
required evidence recall** under its fixed byte budget; selected-path precision was
`0.5` because each task selected all four files in the intentionally small Axios
subset while requiring two. The cases therefore expose useful future precision room,
but they did **not** demonstrate a correctness/selection defect that justified an
algorithm change in #922.

These are independent external source subsets, not complete repository measurements.
Their annotations are checked in and visible to the implementation, so they are
**not** a blinded holdout. The annotations are grading data and are not passed into
the selector. Report truth records both facts explicitly.

Earlier external cases exposed graph-neighbor selection gaps where a lexical/JSDoc
hit could still omit the exported declaration or later implementation evidence. For
one-hop `graph:dependency:*` and `graph:dependent:*` sources, the selector can expand
into a bounded exported declaration text window while preserving exact budget and
provenance. The benchmark budgets/evidence were not loosened to make those cases pass.

## Agent-run measurement records

`context-agent-eval.ts` defines a strict, content-addressed record/report contract for
future baseline-versus-Solve-Context Claude and Codex runs. It does **not** launch an
agent or contact a provider. The caller supplies records collected by a separately
authorized run, and the local harness validates and summarizes them.

A pair must use the same suite/pair fixture identity, pinned fixture revision, agent,
provider/model and record class. Cross-agent handoff fixtures must identify direction
as `claude-to-codex` or `codex-to-claude`; other categories cannot set a handoff
direction. The baseline cannot claim a Solve Context pack or selection metrics. The
context arm must identify its pack and selected bytes.

### Pair comparability hardening (#920)

Baseline and Solve Context arms must also use the same:

- outcome-evaluation basis (`human-reviewed` vs `deterministic-check`), and
- `evidenceRequired` denominator.

This prevents an arm from changing the grading method or shrinking the required
evidence set while still appearing to preserve 100% recall. Mismatches fail closed.

Task success and exact-evidence counts remain beside usage, latency, selection
precision/recall and cache-hot mutation evidence so a smaller context cannot hide a
quality regression.

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
uses synthetic-only records to verify CLI/claim boundaries in MCP CI. Do not commit
real provider credentials, prompts containing secrets or private customer content as
benchmark records.

`benchmarkEvidenceComplete` remains false until measured pairs satisfy **all** #898
acceptance gates: all six fixture categories, both Claude and Codex, both handoff
directions, no quality regression, provider-reported token usage and measured latency
for every measured pair, measured selection precision/recall for every Solve Context
arm, and measured `cacheHotBytesChanged: 0` for every safe-mode context arm.
Missing/estimated/synthetic values cannot satisfy these gates. Even a complete
engineering report keeps `publicationAuthorized: false` and
`publicPercentageClaimAllowed: false`; repository evidence is not publication approval.

## Distribution truth

The repository source/package line is **v0.3.0**, and the `v0.3.0` Git tag exists.
The benchmark/package/plugin CI proves current source can be qualified and packed; it
does not prove npm/package registry or marketplace publication unless those external
records are separately verified. Public v0.2.0 consumers remain on the historical
package line.

## Limits and remaining proof

The first-party regression corpus plus the three external subsets improve coverage but
do not constitute a whole-repository benchmark, a blinded held-out evaluation or a
completed Claude/Codex coding task. The record/report contract makes future real
measurements comparable; it does not create those measurements. Provider input/output
tokens, cache reuse, real task-success rates and competitor results remain unmeasured
until separately authorized runs supply truthful records. Excerpt-byte reduction is
not token savings, and local timing is not end-to-end agent latency.

Issue #898 still needs broader/larger independently pinned or genuinely blinded
evaluation beyond these small source subsets, actual Claude/Codex task runs including
bidirectional long-session handoff, measured quality/token/cache/selection/latency
evidence, and versioned distribution proof before public savings or
comparative-performance claims. These suites grant no provider credential, network,
billing, deployment, publication or Solve Runner authority.
