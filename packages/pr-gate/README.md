# SolveLang PR Gate (`@solvelang/pr-gate`)

The PR Gate wires SolveLang's existing engines — the Solve Graph, the
Repository Audit inventory, and the Solve Context pack builder — into the
pull-request path. On every PR it:

1. **Builds the Solve Graph** from the checkout with the repository's own
   extractors (inventory + JS/TS, PHP, and Python import extractors) and
   verifies the graph document's integrity before trusting it.
2. **Computes the blast radius** of the changed files: the transitive
   dependents, with the engines' own impact explanations (plain-language
   sentences per impacted node).
3. **Generates a verified context pack** for the change + impact set with
   the Solve Context pack builder: content-hash-pinned excerpts with
   per-file reasons, under a byte budget.
4. **Evaluates a policy file** and emits a verdict per rule.

Outputs, written to the `--out` directory:

- `report.md` — a markdown report (pack summary, blast-radius audit,
  affected validations, policy verdicts) that starts with the marker
  `<!-- pr-gate:report -->` so a workflow can keep ONE sticky comment per PR.
- `result.json` — the machine-readable result (`solvelang.pr-gate.result.v1`).
- `pack.json` — the full verified context pack.

There is no second graph engine in this package: its `tsconfig.json`
compiles the engines' own sources (`site/app/solve-graph/core`,
`site/app/repository-audit/core`, and the MCP server's
`src/context-workspace.ts`) into `dist/`, mirroring the compile settings
the site's own studio tests use (CommonJS, Node module resolution).

## Usage

### As a GitHub Action (recommended)

Use the composite action in this directory and the consumer workflow
template next to it (`workflow-template.yml`): copy the template into
`.github/workflows/pr-gate.yml`, pin the kit to a full commit SHA of
`saiidz/solvelang`, choose the mode, and point `policy-path` at your
policy file. The template posts/updates the sticky comment and the job's
conclusion is the gate. To make the gate block merges, add the `pr-gate`
check to branch protection's required status checks.

Inputs: `mode` (`report-only` | `enforce`), `policy-path`, `changed-files`
(computed from the PR base when empty), `labels` (for overrides),
`base-ref`, `out-dir`, `task`.

### As a CLI

```bash
cd packages/pr-gate
npm ci
npm run build
node dist/packages/pr-gate/src/cli.js \
  --root /path/to/checkout \
  --changed src/a.ts,src/b.ts \
  --policy pr-gate.policy.json \
  --mode enforce \
  --labels pr-gate:override \
  --out .pr-gate-out
```

Options: `--root` (required), `--changed` (comma-separated, repo-relative),
`--policy`, `--mode` (`report-only` default, or `enforce`), `--labels`,
`--task` (extra pack context), `--repo` (display name, default derived from
git), `--sha` (default: `git rev-parse HEAD`), `--budget` (pack byte
budget, default 65536), `--out` (default `.pr-gate-out`),
`--keep-artifacts` (keep the staged graph under `<root>/.pr-gate/`).

### Exit codes

- `0` — no failing policy rule. Always the exit code in `report-only`
  mode, even when a rule fails (the verdict is still recorded).
- `1` — a policy rule failed in `enforce` mode.
- `2` — operational error (bad arguments, unreadable policy, engine
  failure, graph integrity failure). Fails the job in every mode.

### Engine size limits

The context engine reads workspace files — and the graph document —
through a reader with a 2 MB safety limit. The gate respects that limit
instead of failing on it: a changed or impacted file over 2 MB is
excluded from the pack (it still appears in the blast-radius audit) and
listed in the report as skipped-oversize; a changed or impacted file that
is not a text file (its bytes contain a NUL, the context engine's own
binary signal) is likewise excluded from the pack and listed in the report
as skipped-binary, never failing the run; when the serialized Solve
Graph itself exceeds 2 MB (large repositories), the pack is built from
the changed + impacted file list without graph relevance hints, and the
report says so.

## Policy file format (v1)

A JSON object. Unknown keys are rejected; `version` must be `1`.

```json
{
  "version": 1,
  "overrideLabel": "pr-gate:override",
  "protectedPaths": [
    { "glob": ".github/workflows/**" },
    { "glob": "services/api-access/src/**", "overrideLabel": "api-access:override" }
  ],
  "maxImpactNodes": 250,
  "requireAffectedValidations": true
}
```

### Rules

Every rule is grounded only in what the engines compute:

1. **Protected paths** (`protectedPaths`): if any changed file matches a
   protected glob, the rule fails. Glob syntax: `**` spans path segments,
   `*` matches within one segment, `?` matches one character; paths are
   repository-relative with `/` separators.
2. **Blast-radius ceiling** (`maxImpactNodes`): if the impact set
   (transitive dependents of the changed files, per
   `analyzeSolveGraphImpact`) contains more nodes than the ceiling, the
   rule fails.
3. **Affected validations** (`requireAffectedValidations`): if the impact
   set includes validations, the PR must also change at least one of them,
   or the rule fails. "Validations" has two engine-grounded sources:
   validation-kind graph nodes (tests, workflows, jobs) from the engines'
   affected-validation candidates, and impacted files the Repository Audit
   inventory classifier (`classifyRepositoryFile`) marks as tests — the
   dependency graph itself carries file nodes, so both sources are needed
   and both come from the engines, never from a private re-implementation.

Rules that are not configured are reported as `skipped`.

### Overrides

A failing rule is downgraded to `overridden` (counted as passing, and
shown as overridden in the report) when the PR carries the rule's
override label:

- Protected paths: the entry's own `overrideLabel` if set, otherwise the
  policy-wide `overrideLabel`.
- Ceiling and affected-validations: the policy-wide `overrideLabel`.

The workflow passes the PR's labels to the gate; adding the label and
pushing (or the `labeled` event) re-runs the gate with the override in
place.

## Modes

- `report-only`: the report and verdicts are produced, the exit code is
  always 0. Use this to adopt the gate and tune the policy.
- `enforce`: a failing verdict exits 1, the check goes red, and — once
  the check is required in branch protection — the merge is blocked
  until the violation is fixed or an override label is applied.

## Development

```bash
npm ci
npm test   # builds, then runs the node:test suite
```

The tests cover the glob matcher, policy parsing/evaluation (including
override precedence), and end-to-end runs against a fixture repository
built at test time: a leaf change with a known impact chain
(`leaf <- mid <- top <- top.test`), a protected-path violation, a
ceiling violation, and override-label passes in both modes.
