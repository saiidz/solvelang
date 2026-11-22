# Solve Context agent-evaluation run protocol

This document is the operator run protocol for Phase 1 of the SolveLang upgrade
plan: the measurement program that satisfies pending items 1 and 2 of
saiidz/solvelang-ops issue #8 ("Independent held-out evaluation of Solve Context
selections" and "Real Claude/Codex measurements (tokens, latency, quality) under
that eval") and that can honestly flip `benchmarkEvidenceComplete` in the
agent-eval report. It changes no gate. The gates themselves live in
`benchmarks/README.md` and in the record/report contract
(`src/context-agent-eval.ts`); this protocol defines the only procedure whose
outputs may be fed to the summarizer as measured evidence.

Read `benchmarks/README.md` first. Its limits bind everything here: excerpt-byte
reduction is not token savings, local timing is not end-to-end agent latency,
synthetic records never count as measured evidence, and even a complete
engineering report keeps `publicationAuthorized: false` and
`publicPercentageClaimAllowed: false`.

## 0. Identities and the build under test

- Agent-run suite id: `agent-eval-v1` (registry:
  `benchmarks/agent-eval-fixtures-v1.json`, schema
  `solvelang.context.agent-eval-fixtures.v1`).
- Record schema: `solvelang.context.agent-eval-record.v0`. Report schema:
  `solvelang.context.agent-eval-report.v0`.
- The build under test is one named commit of `saiidz/solvelang`. Every run log
  records it as `buildCommit`. The pack/selection code path under test is
  `packages/mcp-server` at that commit, built with `npm run build`. A matrix is
  valid only if every pack, score, and record in it comes from that one build.
- Operator tooling, in execution order:
  1. `npm run eval:context:agent-matrix` — generates the run matrix: cells,
     record templates, run-log templates, and the checklist
     (`scripts/generate-agent-eval-matrix.mjs`).
  2. `npm run eval:context:agent-records:validate` — validates records one by
     one as they arrive (`scripts/validate-context-agent-evals.mjs`).
  3. `npm run eval:context:agent-records` — pairs, aggregates, and applies the
     gates (`scripts/summarize-context-agent-evals.mjs`).
  4. `npm run eval:context:agent-summary` — renders a report as Markdown
     tables (`scripts/render-agent-eval-summary.mjs`).

## 1. Track A — independent held-out evaluation (ops #8 item 1)

Track A evaluates Solve Context *selection* on a corpus the selector's authors
did not tune against, using the pre-committed answer-key protocol already
implemented in `scripts/context-heldout-eval.mjs`
(`eval:context:holdout:select` / `eval:context:holdout:score`). The checked-in
corpora (the synthetic suite, the pinned `saiidz/solvelang` regression corpus,
and the axios/chalk/node-fetch/preact subsets) are **not** holdout material:
their annotations are checked in and visible to the implementation.

### 1.1 Roles and the independence rule

- **Key author / evaluator (KA):** authors the corpus, the cases, and the
  answer key; publishes the answer-key commitment; scores the selection
  transcript; files the attestation.
- **Selection operator (SO):** runs `holdout:select` on the public input and
  retains the transcript and selection receipt.

Independence rule — a person is disqualified as KA for a corpus if they:

- authored or modified `src/context-selection.ts`, `src/context-pack.ts`, or
  the MCP context tools in the history of the build under test; or
- received any selector output for that corpus before publishing the answer-key
  commitment.

A person is disqualified as SO for a corpus if they have seen the answer key
(or anything derived from it beyond the published commitment hash) before the
selection transcript and receipt exist. The KA must not run selection; the SO
must not score. If either rule is broken, the corpus is burned: author a new
corpus with a new evaluation id and start over.

### 1.2 Corpus and procedure

1. The KA pins a new MIT-licensed repository snapshot as a public holdout input
   (schema `solvelang.context.heldout-public.v1`): exact 40-hex commit pin,
   at most 32 sources and 2 MiB total, at most 32 cases, every case's
   `changedPaths` present in the corpus.
2. The KA builds the answer key (schema
   `solvelang.context.heldout-answer-key.v1`, `recordClass: "external-heldout"`,
   `evaluatorId` naming the KA) and publishes its commitment
   (`answerKeyCommitment`, the `sha256:…` value produced by the evaluator's
   commitment function) in a durable, timestamped place — a comment on
   saiidz/solvelang-ops issue #8 — **before** any selection run.
3. The SO runs `npm run eval:context:holdout:select` with the public input on
   stdin and retains the emitted transcript and selection receipt unchanged.
4. The KA runs `npm run eval:context:holdout:score` with
   `{transcript, selectionReceipt, answerKey}` on stdin. The scorer itself
   verifies that the revealed key matches the pre-selection commitment and
   that the key was absent from the selector input.
5. The KA files an attestation on ops #8: their `evaluatorId`, a statement
   that the independence rules in §1.1 held, the commitment, the transcript
   hash, and the score report.

Claim discipline: the score report's truth block keeps
`genuinelyBlindedEvidenceEstablished: false` by design. The claim this track
supports is exactly "independently evaluated under a pre-committed answer key,
with evaluator attestation" — never a stronger blinding claim.

## 2. Track B — real Claude/Codex measured runs (ops #8 item 2)

Track B runs real coding agents on fixed tasks, with and without a Solve
Context pack, and records the results under the v0 contract.

### 2.1 Task set

Tier 1 is the gate matrix. Its seven fixtures are defined in
`benchmarks/agent-eval-fixtures-v1.json` and derived one-to-one from the fixed
synthetic suite `benchmarks/context-v0.json`, whose six cases map onto the six
record-contract categories:

| Fixture id | Source case | Contract category | Agents |
| --- | --- | --- | --- |
| `bug-fix-invoice-retry` | `bug-fix-invoice-retry` | `monorepo-bug-fix` | claude, codex |
| `github-issue-session-refresh` | `github-issue-session-refresh` | `github-issue-triage` | claude, codex |
| `ci-payment-webhook` | `ci-payment-webhook` | `ci-log-diagnosis` | claude, codex |
| `auth-validator-refactor` | `auth-validator-refactor` | `multi-file-refactor` | claude, codex |
| `github-actions-json-failure` | `github-actions-json-failure` | `json-heavy-tool-output` | claude, codex |
| `handoff-claude-to-codex` | `claude-codex-handoff` | `cross-agent-handoff` | claude (leg 1) → codex (leg 2) |
| `handoff-codex-to-claude` | `claude-codex-handoff` | `cross-agent-handoff` | codex (leg 1) → claude (leg 2) |

Category notes: the suite labels the first case `bug-fix`; its contract
category is `monorepo-bug-fix`. For handoff fixtures the record's `agent`
field names the originating (leg-1) agent. The suite case's `handoff` block
names claude → codex; the codex → claude fixture runs the same case with the
agent roles reversed. Each fixture's `revisionSha256` is the SHA-256 of the
canonical JSON of its source case, computed by the matrix generator — never
copied by hand.

Tier 2 is a pre-publication extension, defined in §5: the four pinned
real-source tasks of `benchmarks/context-repository-v1.json` and the eleven
tasks of the independent subsets (axios 3, chalk 2, node-fetch 2, preact 4).
Today those suites are selection-track evidence only; they enter the agent-run
matrix only through a reviewed registry revision that assigns each new fixture
a contract category with a written `categoryBasis`, following the same pin
discipline `benchmarks/README.md` requires for a replacement corpus.

### 2.2 Workspace materialization

For each arm of each repetition, materialize the fixture's workspace fresh:

1. Expand every source of the source case exactly as
   `scripts/run-context-evals.mjs` does (`text` verbatim, or the bounded
   `repeat` expansion).
2. Write each source to its case-relative path under a new empty directory.
3. Record the workspace tree hash in the run log
   (`workspaceTreeSha256`: SHA-256 over the sorted `path + sha256(text)`
   entries).
4. Never reuse a workspace across arms or repetitions; reset between arms.

### 2.3 The two arms

Both arms of a pair use the same agent, the same provider/model, and the same
tool settings (including any effort/reasoning setting); the run log records
them. Model settings cannot be identical across agents — pairs never mix
agents, and cross-agent comparisons are reported per agent, never pooled into
a single pair.

- **Baseline arm.** A fresh agent session in the materialized workspace. The
  SolveLang MCP server is not configured and no pack is provided. The
  operator's first and only task message is the source case's `task` text.
- **Solve Context arm.** Before the session, the operator builds the pack from
  the materialized workspace with the build under test (`buildContextPack`
  with the case's `task` and `budgetBytes`, e.g. through the MCP
  `solvelang_context_pack` tool) and saves the serialized pack. The agent's
  first message is the case's `task` text followed by the full serialized
  pack JSON. The SolveLang MCP server (read-only tools) is configured for
  this arm. The pack actually handed to the agent is the "served" pack of
  §2.5.
- **Handoff fixtures.** Leg 1 works the task in its arm's workspace. In the
  Solve Context arm, leg 1 then produces a Solve Context handoff document for
  the case's `changedPaths` using the build under test
  (`solvelang_context_handoff`); leg 2 (the other agent) receives the
  workspace and the handoff document and completes the task. In the baseline
  arm, leg 1 passes only its own raw notes and the workspace — no handoff
  document, no pack. The pair's deliverable is leg 2's final output.

Arm order alternates by repetition (odd repetitions baseline first, even
repetitions Solve Context first), as generated in the matrix checklist.

**No coaching.** After the task message, the operator does not help: no hints,
no corrections, no mid-task file edits, no answering of agent questions with
task knowledge. Clarifying the mechanics of the harness (where output goes) is
allowed; anything about the task is not. A coached run is void and is
re-run as a new repetition with a new pair id.

### 2.4 Metrics and their exact sources

| Metric | Record field(s) | Exact source |
| --- | --- | --- |
| Provider input/output tokens | `usage.inputTokens`, `usage.outputTokens`, `usage.basis: "provider-reported"` | The agent tool's own end-of-session usage report. Claude Code: the session usage summary — `input_tokens`, `output_tokens`. Codex: the CLI's end-of-run token usage report — input and output token counts. |
| Provider cache tokens | `usage.cacheReadTokens`, `usage.cacheWriteTokens` | Claude Code: `cache_read_input_tokens` → cacheRead, `cache_creation_input_tokens` → cacheWrite. Codex: the cached-input figure → cacheRead when the tool reports one; otherwise both fields are `null` and the run log notes that the tool did not report a cache split. |
| Latency | `latency.wallMs`, `latency.basis: "measured"` | Operator-measured wall clock: from submission of the task message to the agent's completion signal, per arm. |
| Task success | `outcome.taskSuccess`, `outcome.basis: "human-reviewed"` | Reviewer judgment under the rubric in §2.6. The reviewer is never the operator of that run. Basis is uniform across the whole matrix (the contract requires pair-uniformity since #920; this protocol makes it matrix-uniform). |
| Evidence retained | `outcome.evidenceRequired`, `outcome.evidenceRetained` | `evidenceRequired` is the fixture's total required-evidence needle count (the counting rule of `scorePack` in `scripts/run-context-repository-evals.mjs`: one per needle across all `requiredEvidence` paths), prefilled by the matrix generator. `evidenceRetained` is counted mechanically by the reviewer: a needle counts only if it appears verbatim in the agent's deliverable, or in the final workspace state the deliverable depends on, in a way the rubric in §2.6 accepts. |
| Multi-file edit failures | Run-log sidecar only (see below) | Reviewer count from the run's diff and transcript, under the definition below. |
| Selection precision/recall | `context.selectionPrecision`, `context.selectionRecall`, `context.selectionMetricsBasis: "measured"` | The build under test's own scorer for the source case (`evaluateCase` in `scripts/run-context-evals.mjs`): precision = the pack's path precision, recall = the pack's path recall. "Measured" is allowed only when the scorer's JSON output is retained in the run log (`scorerOutputRef`); hand-computed or estimated values are forbidden in measured records. |
| Pack identity/size | `context.packId`, `context.selectedBytes` | From the built pack itself (`scp_…` id and `selectedBytes`). |
| Cache-hot mutation | `context.cacheHotBytesChanged`, `context.cacheHotBytesChangedBasis: "measured"` | See §2.5. |

**Multi-file edit failure — definition.** During one run, each of the
following is one countable event, counted once per run per type by the
reviewer from the run diff and transcript:

- **E1 (forbidden write):** the agent writes to any path in the fixture's
  `forbiddenPaths`.
- **E2 (evidence destruction):** the agent's edits remove or alter a span of
  workspace text that contains a required-evidence needle, so the needle no
  longer exists verbatim anywhere in the final workspace (edit tasks) or the
  deliverable misquotes it (analysis tasks).
- **E3 (out-of-set write):** the agent creates or modifies a file outside the
  fixture's source path set, other than its designated deliverable/output
  location.

The v0 record has no field for this count — a named limitation of the
contract, not something to improvise around. Counts live in the run log
(`multiFileEditFailures`, one entry per event: `{type, path, detail}`), are
retained with the records, and are reported beside the summary at publication
time. E2 events also flow into the record itself: destroyed needles cannot
count in `evidenceRetained`, which is how edit failures reach the pair's
non-regression gate. Carrying the count inside the record requires a future
contract revision (v1) and is out of scope for this protocol.

### 2.5 Cache-hot measurement

In safe mode the Solve Context arm serves a prepared ("hot") pack; the gate
requires measured proof that the hot path did not mutate the pack
(`benchmarks/README.md`: a measured safe-mode context arm must record
`cacheHotBytesChanged: 0`; the report does not infer zero from missing data).
Procedure: build the pack twice from identical inputs — once cold
(`packColdSha256` over the serialized pack) and once as the exact artifact
handed to the agent (`packServedSha256`). `cacheHotBytesChanged` is the number
of bytes by which the two serialized packs differ (0 when byte-identical).
Packs are deterministic (the suites check this), so a faithful procedure
yields 0; any non-zero value is real evidence and blocks completeness until
explained.

### 2.6 Grading rubric (human-reviewed outcomes)

The reviewer grades legibly against the fixture, not against taste:

- `taskSuccess: true` requires the deliverable to accomplish the source
  case's `task` as written — the fix actually fixes, the diagnosis names the
  actual fault, the triage identifies the actual cause, the refactor preserves
  behavior across all callers — **and** `evidenceRetained` to equal
  `evidenceRequired` is *not* required for success, but any missing needle
  must be listed in the run log with the reviewer's reason.
- `taskSuccess: false` when the deliverable is wrong, incomplete in a way
  that changes the answer, touches forbidden paths (E1), or succeeds only
  because the operator helped (also void under §2.3).
- Disagreements between reviewer and operator are resolved by a second
  reviewer; the resolution is noted in the run log.

### 2.7 Run counts and matrix discipline

`repsPerCell: 3` (registry-pinned). Agent output is stochastic: one run per
cell cannot distinguish a Solve Context effect from luck. Three repetitions
per cell is the minimum that gives the publication table a median and exposes
one-off failures, while keeping the matrix executable: 5 two-agent fixtures ×
2 agents × 3 repetitions = 30 pairs, plus 2 handoff fixtures × 3 repetitions
= 6 pairs — **36 pairs, 72 records**.

The contract's quality gate is all-or-nothing across measured pairs: a single
regression pair keeps `benchmarkEvidenceComplete` false. That is deliberate.
When a pair regresses, investigate and fix the cause (selector, pack, or
protocol), then re-run the **full** matrix under a new matrix generation.
Partial re-runs and cherry-picked repetitions are invalid: every record in a
summarized set must come from one matrix generated from one registry revision
against one build commit.

Validate every record on arrival (`eval:context:agent-records:validate`);
a record that fails validation is fixed from the run's retained evidence or
the run is void and re-run — never edited into validity from memory.

## 3. Clean-reproduction protocol

A second operator, on a clean checkout at the same build commit, with no
access to the first operator's records until their own reproduction artifacts
exist, reproduces the matrix result:

1. **Deterministic layers reproduce exactly.** Re-run `npm run eval:context`,
   `npm run eval:context:repository`, `npm run eval:context:independent`, and
   the Track A score from the retained transcript and answer key. Suite
   reports and the score report must match the originals (same report ids /
   transcript hashes).
2. **Summarization reproduces exactly.** Re-run
   `eval:context:agent-records` on the retained record array: the report must
   be identical, including `reportId`.
3. **Spot re-run within tolerance.** Re-run one full fixture column fresh —
   `bug-fix-invoice-retry`, both agents, one repetition, both arms — under
   this protocol. Tolerance: `taskSuccess` must agree on both pairs, and the
   column's aggregate provider input-token delta percent must fall within
   ±10 percentage points of the original column figure.
4. Any mismatch beyond tolerance means the matrix is not reproducible:
   publication is blocked, the discrepancy is investigated, and the full
   matrix is re-run if the cause touches measurement.

Reproduction artifacts (commands, outputs, the spot re-run records) are
retained beside the matrix records.

## 4. Publication rule

Numbers may be published only when **all** of the following hold:

1. The summarizer's report for the full Tier 1 matrix has
   `aggregate.benchmarkEvidenceComplete === true`.
2. The Track A score report has `aggregate.pass === true` with
   `recordClass: "external-heldout"` and the key author's attestation filed
   on saiidz/solvelang-ops issue #8.
3. The clean-reproduction protocol (§3) passed and its artifacts are
   retained.
4. The Tier 2 extension (§2.1) has landed as a reviewed registry revision and
   its matrix has been summarized with no quality regression. Tier 1's small
   synthetic workspaces alone do not support public percentage claims.
5. A separate, explicit owner publication decision authorizes publication.
   The report contract hard-codes `publicationAuthorized: false` and
   `publicPercentageClaimAllowed: false`, and `benchmarks/README.md` states
   that repository evidence is not publication approval. This protocol
   cannot flip those flags and does not try.

When all five hold, publish the renderer's output
(`npm run eval:context:agent-summary`) for the final report — its tables
verbatim — to: the site's Solve Context page and the homepage Solve Context
section (replacing the current no-claims text), `llms.txt`, and a new dated
section in `benchmarks/README.md` (plus the repo README if it carries
performance claims). Token percentages appear only as the report's own
aggregates, and never without the task-success and evidence-recall figures
beside them.

## 5. What this protocol does not satisfy

Named plainly, so nobody has to discover them later:

- **The v0 record cannot carry the multi-file edit-failure count.** It lives
  in run-log sidecars (§2.4). A contract v1 is future work.
- **Tier 1 workspaces are small synthetic slices.** Effect sizes measured on
  them will understate monorepo reality; §4 item 4 exists for this reason.
- **The held-out protocol cannot establish genuine blinding by itself.** The
  score report says so in its own truth block. Independence rests on the
  pre-committed answer key plus the evaluator's attestation (§1).
- **Provider token figures depend on each tool's own usage reporting.** If a
  tool changes what it reports (for example, drops the cache split), cache
  fields go `null` — the contract still counts the pair — and the run log
  must note the change. If a tool stops reporting input/output tokens
  entirely, its runs cannot be measured evidence at all.
- **Ops #8 items 3 and 4 are out of scope.** Managed-workspace import and the
  Plugin Directory listing are distribution work, not measurement; nothing in
  this protocol advances or claims them.
