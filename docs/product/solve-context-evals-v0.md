# Solve Context evals v0

Status: **synthetic + pinned real-source regression suites with a strict offline contract for future real-agent measurements; complete real Claude/Codex provider evidence not yet collected**  
Tracking epic: #898  
Reconciled through #923 on 2026-09-15.

## Purpose

The evaluation stack makes Solve Context regressions measurable before any public claim is made about Claude Code, Codex, token savings, latency, cache behavior or competitors.

Run from `packages/mcp-server`:

```bash
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
```

MCP CI runs these alongside package tests, plugin packaging/roundtrip, packed-consumer proof and dependency audit.

## Evaluation layers

### 1. Synthetic deterministic suite

`npm run eval:context` covers all six #898 fixture categories:

- monorepo bug fix;
- GitHub issue triage;
- CI/log diagnosis;
- multi-file refactor;
- JSON-heavy tool output;
- cross-agent handoff.

It records exact bytes, path/evidence precision/recall proxies, integrity and deterministic pack/handoff behavior. Synthetic byte reduction is a regression metric, not provider-token savings.

### 2. Pinned first-party repository suite

`npm run eval:context:repository` uses complete pinned SolveLang source files from an immutable reviewed revision with Git blob/SHA-256 checks and manually authored evidence expectations.

The suite compares equal-byte-budget arms:

- lexical only;
- changed-path hints;
- changed-path plus bounded graph hints.

It exposed real selector defects that were fixed without weakening fixture budgets, including declaration-window and budget-fragment behavior. Exact source/excerpt identity, omission truth and evidence non-regression remain required.

### 3. Independent pinned external-source suite

`npm run eval:context:independent` uses separately pinned MIT source subsets from:

- `axios/axios` — four complete core source files and three cross-file tasks;
- `chalk/chalk` — two complete source files and two tasks;
- `node-fetch/node-fetch` — three complete source files and two tasks;
- `preactjs/preact` — the complete 13-file JavaScript runtime tree under `src/` (including `src/diff/`) and four cross-file tasks.

The committed aggregate is therefore **4 external repositories, 22 complete source files and 11 fixed tasks**. Snapshots are data only, never executed, and are verified by exact upstream Git blob identity plus local SHA-256/integrity checks.

#922 added the Axios cases without changing selector/runtime code. #923 materially increased the corpus with Preact and exposed additional deterministic selection/harness gaps before merge. The resulting focused repairs:

- resolve extensionless relative ESM imports only against exact JS/TS or `index` paths already present in the validated pinned corpus;
- derive bounded singular and `-tion` task-token aliases so related declaration/callsite wording can be reached without semantic guessing;
- suppress high-frequency bridge terms when a graph-selected source also contains more specific task evidence;
- rank explicit structural selection evidence ahead of unrelated lexical repetition under tight budgets.

Those changes are covered by focused regression tests and do not relax existing corpus evidence, precision, budget, determinism or exact-integrity gates. The final candidate independent regression reports the full **4-repository / 22-file / 11-task aggregate passing**.

The annotations remain checked into the repository and visible to implementation authors, so the suite is **not** a blinded holdout or whole-repository benchmark. The grading annotations are not passed into the selector, and the report states both facts explicitly.

Earlier Chalk/node-fetch cases exposed graph-neighbor/JSDoc/exported-declaration selection gaps. Axios broadened the corpus without exposing a new correctness defect. Preact is the first larger coherent runtime-tree increment and did expose the additional selector/harness gaps listed above.

### 4. Real-agent measurement record/report contract

`context-agent-eval.ts` defines an offline schema for future separately authorized baseline-vs-Solve-Context Claude/Codex runs. The harness itself does not launch an agent, call a provider or use credentials.

Summarize previously collected records with:

```bash
cat approved-agent-run-records.json | npm run eval:context:agent-records
```

The CLI reads bounded stdin only. Do not commit credentials, private prompts or customer content as benchmark records.

## Real-agent pair integrity

A baseline and Solve Context record pair must describe the same:

- suite/pair identity;
- fixture ID/category/revision and handoff direction;
- agent;
- provider and model;
- record class;
- outcome-evaluation basis;
- required-evidence denominator.

#920 added the last two checks after a review found that different evidence denominators or evaluation bases could otherwise make incomparable arms look equivalent. Pair mismatches now fail closed.

## Measurement truth

Token and measurement bases remain distinct:

- `provider-reported` — only basis included in provider-token aggregates;
- `local-tokenizer` — reported separately with explicit tokenizer identity;
- `estimated` — reported separately with explicit estimator identity;
- `unavailable` — requires null metrics, never guesses;
- `synthetic` — fixture/test data only and excluded from measured aggregates.

Measured latency, selection precision/recall and cache-hot-byte evidence are also distinct from estimated/unavailable/synthetic values.

A context arm cannot hide a quality regression behind lower input size. Quality non-regression requires that Solve Context does not lose baseline task success and does not reduce exact-evidence recall.

## `benchmarkEvidenceComplete`

The engineering evidence matrix remains incomplete until **all** of the following are true for measured pairs:

- all six acceptance categories are covered;
- both Claude and Codex are covered;
- both `claude-to-codex` and `codex-to-claude` handoff directions are covered;
- no quality regression is present;
- every measured pair has provider-reported token usage;
- every measured pair has measured wall-clock latency;
- every Solve Context arm has measured selection precision and recall;
- every safe-mode Solve Context arm has measured `cacheHotBytesChanged: 0`.

Missing, local-tokenizer, estimated or synthetic values cannot satisfy these completion gates.

Even when the engineering matrix becomes complete, the report keeps `publicationAuthorized: false` and `publicPercentageClaimAllowed: false`; business/publication approval is separate.

## Current regression gates

The committed synthetic/pinned-source suites preserve their reviewed exact-integrity, evidence-recall and deterministic-output requirements. Where fixture-specific byte-reduction thresholds exist, those are local regression gates only and must not be generalized to arbitrary repositories or provider tokens.

## What is not yet measured

The repository does not yet provide complete evidence for:

- Claude API/provider input/output token reduction on the acceptance suite;
- OpenAI/Codex provider input/output token reduction on the acceptance suite;
- provider cache reuse improvement;
- end-to-end coding-task success equivalence/improvement across all categories;
- end-to-end agent latency improvement;
- a genuinely blinded/held-out benchmark;
- a controlled competitor comparison.

## Projected benchmark progression

These are priorities, not promised dates:

### Next — genuinely blinded/held-out evidence

The external suite now includes a materially larger coherent runtime-tree corpus, but its grading annotations are still checked into the same public repository. The next repository-evidence improvement should use a genuinely held-out answer key or independent evaluation process rather than merely adding more visible annotations. Do not relax evidence budgets to make a score pass.

### Next — provider token + latency accounting

Run separately authorized Claude/Codex tasks and capture provider-reported usage plus measured wall time. Keep provider, local-tokenizer and estimates separated.

### Next — task-success benchmark

Grade baseline/context task success through tests and reviewed acceptance criteria rather than model self-evaluation. Include both handoff directions.

### Later — competitor comparison

Only after comparable agent versions, repositories, budgets, provider settings and quality gates exist should competitor comparisons be run. Methodology and raw evidence must accompany any comparative claim.

## Claim policy

Describe Solve Context as a correctness-first context-selection/compaction system with synthetic and pinned-source regression evidence. Do **not** state that it has been measured to beat Headroom, that it saves a specific provider-token percentage, or that it improves real-agent success/latency until the corresponding measured evidence exists and publication is separately approved.
