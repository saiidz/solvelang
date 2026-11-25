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

## Gitea / Forgejo: receipt collector + gate wrappers

The PR Gate core and the Change Impact Receipt builder are
platform-neutral; only their GitHub packaging was GitHub-shaped. This
kit also ships the Gitea/Forgejo packaging. Gitea and Forgejo share one
REST API family (`/api/v1`), so one collector and one wrapper design
cover both forges; the per-platform differences are in the workflow
templates, where each platform's own documentation puts them.

### Receipt collector (`solvelang-forge-receipt`)

Reads one pull request from a self-hosted Gitea or Forgejo instance and
emits a Change Impact Receipt **input** object — the exact JSON shape
the Change Impact Receipts page (`site/app/change-impact-receipt`)
consumes. Paste the output into that page (or feed it to
`buildChangeImpactReceipt`) to get the receipt: findings labeled
verified / failed / unverified, the standard grading block, no risk
scores. The page itself is unchanged.

```bash
cd packages/pr-gate
npm ci
npm run build
FORGE_TOKEN=<operator token> node dist/packages/pr-gate/src/forge-receipt.js \
  --base-url https://git.example.com \
  --owner octo --repo demo --pr 7 \
  --platform gitea \
  --gate-result .pr-gate-out/result.json \
  --out receipt-input.json
```

- `--platform` is `gitea` (default) or `forgejo`; it only names the API
  in the receipt's provenance — the endpoints are the same.
- The token is supplied by the operator at runtime (`--token`, or
  `FORGE_TOKEN` / `GITEA_TOKEN` / `FORGEJO_TOKEN`) and is never stored,
  logged, or written to the output.
- The collector reads the PR, its files, its submitted reviews, its
  commit list, and the combined commit status of the head SHA (the
  latest status per context becomes the receipt's check-run list). If
  any of those reads fail, the collector exits `2` (operational error)
  rather than emitting a partial input the builder would over-claim
  from. The compare read is the one exception: if it cannot answer,
  `compare` is `null` and the builder labels base drift unverified.
- Platform vocabulary is mapped, never invented: `REQUEST_CHANGES`
  becomes `CHANGES_REQUESTED`; unsubmitted reviews (`PENDING`,
  `REQUEST_REVIEW`) are dropped; commit-status `error` maps to the
  receipt's `failure` conclusion, `warning` to `neutral`, `pending` to
  a still-running check run with no conclusion; a boolean `mergeable`
  becomes `unstable`/`dirty`, an absent one `unknown`.
- `--gate-result` embeds a PR Gate `result.json`
  (`solvelang.pr-gate.result.v1`) as the receipt's PR Gate route. With
  no result supplied, the route is recorded as not run — which the
  builder labels failed, never silently dropped.

Exit codes mirror the PR Gate CLI: `0` = input emitted, `2` =
operational error.

### Gate workflow templates

- `workflow-template.gitea.yml` — copy to `.gitea/workflows/pr-gate.yml`.
- `workflow-template.forgejo.yml` — copy to
  `.forgejo/workflows/pr-gate.yml`.

Both run the same core CLI in report-only mode by default
(`PR_GATE_MODE`), post/update ONE sticky comment (marker
`<!-- pr-gate:report -->`) through the platform's issues-comments API,
and post a commit status with context `pr-gate` to the PR head. Add the
`pr-gate` context to branch protection's required status checks to make
the gate block merges. Platform differences, per each forge's own
documentation:

- Gitea Actions is "designed to be compatible with GitHub Actions" with
  documented differences
  (https://docs.gitea.com/usage/actions/comparison). The job token is
  `GITEA_TOKEN`, available as `${{ secrets.GITEA_TOKEN }}`, with Gitea's
  own permission scopes — GitHub-only scopes such as `statuses` and
  `checks` do not exist, and creating a commit status requires write
  access to the repository's code unit
  (https://docs.gitea.com/usage/actions/token-permissions).
- Forgejo Actions is "designed to be familiar to users of GitHub
  Actions, but it is not designed to be compatible"
  (https://forgejo.org/docs/latest/user/actions/github-actions/): the
  `permissions` job key is ignored (so the Forgejo template has no
  permissions block), some `github` context keys are missing (so both
  templates read PR facts from the API, not the event payload), and the
  automatic token and API endpoint arrive as the `FORGEJO_TOKEN` and
  `FORGEJO_API_URL` environment variables
  (https://forgejo.org/docs/latest/user/actions/reference/).
- Neither template uses a composite-action step for the kit: the
  workflow clones `saiidz/solvelang` at the pinned SHA and runs the CLI
  directly, so self-hosted instances can point `PR_GATE_KIT_URL` at a
  mirror.

## GitLab: receipt collector + gate wrapper

The same platform-neutral core also ships GitLab packaging: a receipt
collector for merge requests and a GitLab CI wrapper for the gate.
GitLab's REST API v4 is a different API family from the forges', so
the collector is a sibling (`solvelang-gitlab-receipt`), not a flag on
the forge one; the emitted receipt input is the same contract.

### Receipt collector (`solvelang-gitlab-receipt`)

Reads one merge request from a GitLab instance (gitlab.com by
default, or any self-hosted base URL) and emits a Change Impact
Receipt **input** object — the exact JSON shape the Change Impact
Receipts page (`site/app/change-impact-receipt`) consumes. Paste the
output into that page (or feed it to `buildChangeImpactReceipt`) to
get the receipt: findings labeled verified / failed / unverified, the
standard grading block, no risk scores. The page itself is unchanged.

```bash
cd packages/pr-gate
npm ci
npm run build
GITLAB_TOKEN=glpat-... node dist/packages/pr-gate/src/gitlab-receipt.js \
  --project gitlab-org/cli --mr 4511 \
  --gate-result .pr-gate-out/result.json \
  --out receipt-input.json
```

- `--project` is the namespaced project path (`group/repo`, nested
  groups allowed) or a numeric project id; `--mr` is the merge
  request IID (the number in the MR URL); `--base-url` defaults to
  `https://gitlab.com` and is set for self-hosted GitLab.
- The token is supplied by the operator at runtime (`--token`, or
  `GITLAB_TOKEN`) and is never stored, logged, or written to the
  output. Public projects read without one.
- The collector reads the MR, its diffs, its commit list, its
  approval state, the jobs of its head pipeline, the current head of
  its target branch, and a two-way compare of head against that base.
  Every field name and status was verified against GitLab's API
  documentation (https://docs.gitlab.com/api/merge_requests/) and
  live gitlab.com reads; the mappings that matter:
  - CI evidence is the head pipeline's job list. A fork MR's pipeline
    runs in the fork project, so jobs are read from
    `head_pipeline.project_id` — reading them from the target project
    404s. Bridge (downstream pipeline) jobs are not claimed. No head
    pipeline means no CI evidence exists for the head, which the
    builder reports as read.
  - Reviews are GitLab's submitted-review record: the approvals
    endpoint's `approved_by` list, in order, each mapped to
    `APPROVED` (https://docs.gitlab.com/api/merge_request_approvals/).
    That endpoint is available on all tiers; Community Edition
    returns a reduced field set that still includes `approved_by`.
    GitLab has no per-reviewer changes-requested review object in
    this API, so none is invented.
  - Mergeability comes from `detailed_merge_status`
    (`merge_status` is deprecated since GitLab 15.6). A conflict is
    `dirty`; `mergeable` is `unstable` (mergeable per the API, with
    CI and review state reported separately); GitLab's still-checking
    values (`checking`, `unchecked`, `preparing`,
    `approvals_syncing`, `commits_status`) are `unknown`; GitLab's
    named-gate values (`ci_must_pass`, `not_approved`,
    `discussions_not_resolved`, `need_rebase`, and the rest) keep
    GitLab's own word as the state string with mergeable true — the
    branches merge, a named gate blocks. Mergeability is only ever
    claimed for open MRs: a merged MR still reports
    `merge_status: can_be_merged` (observed live), so closed/merged
    MRs record mergeable `null` / `unknown`.
  - Job statuses map to the receipt's check-run vocabulary:
    `success`/`failed`/`canceled`/`skipped` are completed results,
    `running` is in progress, and `created`/`pending`/`preparing`/
    `waiting_for_resource`/`scheduled`/`manual` carry no conclusion
    (a manual job has not run; a human must start it).
  - The MR's `changes_count` is a **string** (`"3"`, capped at
    `"1000+"`), so the changed-file count comes from the `/diffs`
    list actually read. The API carries no per-file line counts, so
    additions/deletions are counted from the diff text GitLab
    returns (`+`/`-` lines, excluding the `+++`/`---` headers). A
    file whose diff GitLab withholds (`too_large` or `collapsed`)
    contributes 0/0: the receipt's numbers are the counts of the
    diffs actually read, and this limitation is stated, not hidden.
  - The compare runs on SHAs — current target-branch head against
    the MR head, both directions — which is what makes it work for
    fork MRs. If the compare cannot answer (or reports
    `compare_timeout`), `compare` is `null` and the builder labels
    base drift unverified. If the target branch itself cannot be
    read (for example it was deleted after a merge), the base falls
    back to the MR's `diff_refs.base_sha` — the base the diff was
    computed against — and the compare is skipped for the same
    reason.
- If any required read fails (MR, diffs, commits, approvals, head
  pipeline jobs), the collector exits `2` (operational error) rather
  than emitting a partial input the builder would over-claim from.
- `--gate-result` embeds a PR Gate `result.json`
  (`solvelang.pr-gate.result.v1`) as the receipt's PR Gate route.
  With no result supplied, the route is recorded as not run — which
  the builder labels failed, never silently dropped.

Exit codes mirror the PR Gate CLI: `0` = input emitted, `2` =
operational error.

### Gate CI template

- `workflow-template.gitlab-ci.yml` — copy to `.gitlab-ci.yml` (or
  merge the `pr-gate` job into your existing one).

The job runs in merge-request pipelines on the project's own GitLab
Runner, reads the MR facts (labels, head SHA, changed files) from the
API, runs the same core CLI in report-only mode by default
(`PR_GATE_MODE`), posts/updates ONE sticky MR note (marker
`<!-- pr-gate:report -->`) through the notes API
(https://docs.gitlab.com/api/notes/), and posts a commit status named
`pr-gate` to the MR head commit
(https://docs.gitlab.com/api/commits/). The status is mapped from the
verdict recorded in `result.json`, never from the CLI exit code: in
report-only mode the CLI exits 0 even on a policy FAIL, and the
status says so ("advisory only"). Note and status posts are
best-effort — if the token cannot write (for example a fork pipeline
whose job token is scoped to the fork), the job warns and the report
still lands in the job log and the `.pr-gate-out` artifacts; the
job's exit code is governed by the gate verdict and `PR_GATE_MODE`
only. API calls use `PR_GATE_TOKEN` (a project/group access token or
personal access token with the `api` scope, set as a CI/CD variable)
when defined, and fall back to `CI_JOB_TOKEN`.

**What blocks a merge on GitLab — stated by tier, because the
strength differs and the difference matters:**

- The commit status this template posts (Commit Status API,
  `POST /projects/:id/statuses/:sha`) is available on **all tiers**
  (Free, Premium, Ultimate). A commit status is a signal displayed
  on the commit and the MR; on its own it does **not** block a
  merge.
- **External status checks** — GitLab's dedicated check object that
  can be required to pass before a merge is allowed — are an
  **Ultimate-tier feature** (External Status Checks API:
  https://docs.gitlab.com/api/status_checks/, tier: Ultimate). This
  template does not register one. Below Ultimate there is no check
  object to require.
- On any tier, the enforcement route this template supports is the
  pipeline itself: run with `PR_GATE_MODE=enforce` (a policy failure
  fails the job, so the MR pipeline fails) **and** enable the
  project's "Pipelines must succeed" merge setting. The failed
  pipeline then blocks the merge. In the default report-only mode
  nothing blocks: the note and the status are advisory, exactly as
  labeled.

## Azure DevOps: receipt collector + gate wrapper

The same platform-neutral core also ships Azure DevOps packaging: a
receipt collector for pull requests and an Azure Pipelines wrapper
for the gate. Azure's REST API (api-version 7.1) is a different API
family from both the forges' and GitLab's, so the collector is a
sibling (`solvelang-azure-receipt`), not a flag on the other ones;
the emitted receipt input is the same contract.

### Receipt collector (`solvelang-azure-receipt`)

Reads one pull request from an Azure DevOps organization (Azure
DevOps Services, or an Azure DevOps Server collection URL) and emits
a Change Impact Receipt **input** object — the exact JSON shape the
Change Impact Receipts page (`site/app/change-impact-receipt`)
consumes. Paste the output into that page (or feed it to
`buildChangeImpactReceipt`) to get the receipt: findings labeled
verified / failed / unverified, the standard grading block, no risk
scores. The page itself is unchanged.

```bash
cd packages/pr-gate
npm ci
npm run build
AZURE_DEVOPS_PAT=<pat> node dist/packages/pr-gate/src/azure-receipt.js \
  --org-url https://dev.azure.com/myorg \
  --project WidgetProject --repository widget-repo --pr 42 \
  --gate-result .pr-gate-out/result.json \
  --out receipt-input.json
```

- `--org-url` is the organization root (`https://dev.azure.com/<org>`
  for Azure DevOps Services; the collection URL for Azure DevOps
  Server); `--project` and `--repository` are the team project and
  repository names (or ids); `--pr` is the pull request id.
- The credential is supplied by the operator at runtime and is never
  stored, logged, or written to the output: `--token` takes a
  personal access token (sent as HTTP Basic with an empty user name —
  Microsoft's PAT route; falls back to `AZURE_DEVOPS_PAT`), and
  `--bearer-token` takes an Entra / OAuth token (falls back to
  `AZURE_DEVOPS_BEARER_TOKEN` and takes precedence when both are
  supplied). Public projects read without one where the organization
  allows anonymous access.
- The collector reads the PR, its iterations, the latest iteration's
  change list, its commit list, its status list, the current head of
  its target branch, and a diffs count of head against that base.
  Every field name and enum was verified against Microsoft's REST
  API documentation
  (https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1);
  the mappings that matter:
  - The change list is the PR's own iteration record. Each push
    creates an iteration; the latest iteration's changes, read with
    the endpoint's default comparison (against the common commit),
    are the PR's full per-file change list as Azure computed it
    (https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1),
    walked page by page via `nextSkip`/`nextTop`. Folder entries are
    structure, not changed files. A deleted file's path comes from
    `sourceServerItem`.
  - The merge base is the latest iteration's `commonRefCommit` —
    "the first common Git commit of the source and target refs"
    (https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations/list?view=azure-devops-rest-7.1).
    Azure has no combined-tree preview equivalent to GitHub's, so
    nothing here claims what a merge would produce; and when the PR
    carries `hasMultipleMergeBases`, Azure itself warns the common
    commit is not unique — the iteration's is still the base Azure
    used for its own diff, and it is the one recorded.
  - The API carries **no per-file line counts** for iteration
    changes and no diff text to count from, so additions/deletions
    are `0/0` for every file: the numbers are not estimated. (The
    GitLab collector counts diff text because GitLab returns it;
    Azure does not.)
  - Reviews are the PR's reviewers and their current votes
    (`IdentityRefWithVote.vote`: 10 approved, 5 approved with
    suggestions, 0 no vote, -5 waiting for author, -10 rejected).
    10 and 5 map to `APPROVED` (an approval with suggestions counts
    as an approval in Azure's own policy evaluation); -10 and -5 are
    the reviewer's recorded refusal to approve and map to
    `CHANGES_REQUESTED`; 0 is no vote and is dropped; reviewer
    containers (groups) are dropped — their members vote
    individually. There is no separate reviews endpoint to read.
  - CI evidence is the PR status list — the statuses services post
    through the PR Status API
    (https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-statuses/list?view=azure-devops-rest-7.1).
    Only statuses attached to the latest iteration (plus any
    carrying no iteration id) count as current, reduced to the
    newest status per context (`genre/name`); older iterations'
    statuses are history. States map: `succeeded` → success,
    `failed`/`error` → failure, `notApplicable` → neutral,
    `pending` → in progress, `notSet` → queued with no conclusion.
  - Mergeability comes from `mergeStatus` (PullRequestAsyncStatus),
    claimed only for active PRs: `conflicts` is `dirty`;
    `succeeded` is `unstable` (Azure produced the merge commit —
    the branches merge — with CI and review state reported
    separately); `rejectedByPolicy` keeps Azure's own word with
    mergeable true (the branches merge, a branch policy rejected
    the completion); `failure` claims nothing and keeps Azure's
    word; `queued`/`notSet` are `unknown`. A completed PR's
    `mergeStatus` describes the merge that happened, so completed
    and abandoned PRs record mergeable `null` / `unknown`.
  - The PR object carries no updated-date field, so `updatedAt` is
    the latest iteration's `updatedDate`, falling back to the
    creation date; and its `url` field is the REST URL, so the
    human URL is built from the documented web route
    `{org}/{project}/_git/{repo}/pullrequest/{id}`.
  - The compare runs on SHAs through the diffs endpoint
    (https://learn.microsoft.com/en-us/rest/api/azure/devops/git/diffs/get?view=azure-devops-rest-7.1):
    current target-branch head against the PR head, using the
    counts Azure returns (`aheadCount`/`behindCount`). If the diffs
    read cannot answer, `compare` is `null` and the builder labels
    base drift unverified. If the target branch itself cannot be
    read (for example it was deleted after completion), the base
    falls back to the latest iteration's `targetRefCommit` — the
    target head the PR's own diff was computed against — and the
    compare is skipped for the same reason.
- If any required read fails (PR, iterations, iteration changes,
  commits, statuses), the collector exits `2` (operational error)
  rather than emitting a partial input the builder would over-claim
  from.
- `--gate-result` embeds a PR Gate `result.json`
  (`solvelang.pr-gate.result.v1`) as the receipt's PR Gate route.
  With no result supplied, the route is recorded as not run — which
  the builder labels failed, never silently dropped.

Exit codes mirror the PR Gate CLI: `0` = input emitted, `2` =
operational error.

### Gate pipeline template

- `workflow-template.azure-pipelines.yml` — copy to
  `azure-pipelines.yml` (or merge the steps into your existing PR
  pipeline).

The pipeline runs for pull requests on the project's own agents,
reads the PR facts (labels, head SHA, changed files) from the API —
the latest iteration's change list, since a PR validation build
checks out the merge commit, not the head — runs the same core CLI
in report-only mode by default (`PR_GATE_MODE`), posts/updates ONE
sticky PR thread (marker `<!-- pr-gate:report -->`) through the
threads API, and posts a PR status with context genre `solvelang`,
name `pr-gate` through the PR Status API
(https://learn.microsoft.com/en-us/azure/devops/repos/git/create-pr-status-server).
Azure statuses attach to the pull request itself (the server
associates them with the current iteration), not to a commit. The
status is mapped from the verdict recorded in `result.json`, never
from the CLI exit code: in report-only mode the CLI exits 0 even on
a policy FAIL, and the status says so ("advisory only"). Thread and
status posts are best-effort — if the identity cannot write, the job
warns and the report still lands in the job log and the published
`pr-gate-out` artifact; the job's exit code is governed by the gate
verdict and `PR_GATE_MODE` only. API calls use `PR_GATE_TOKEN` (a
personal access token with Code read/write rights on the
repository, set as a secret pipeline variable) when defined, and
fall back to the build's OAuth token (`System.AccessToken`), whose
identity — the project's build service account — needs the
repository permission "Contribute to pull requests".

**What blocks a merge on Azure DevOps — stated exactly, because the
strength lives in branch policy configuration, not in this
template**
(https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies):

- The PR status this template posts (genre `solvelang`, name
  `pr-gate`) blocks completion **only** when a branch policy of type
  **Status checks** requires that exact `genre/name` with Policy
  requirement set to **Required**. Without that policy the status is
  a displayed signal on the PR: visible, blocking nothing. The
  policy also carries reset conditions and an applicability choice
  (apply by default, or only after the first status posts) — read
  the policy, not the status, as the gate.
- **Build validation** is the enforcement route available to every
  project: name this pipeline in a build validation branch policy
  set to Required and run with `PR_GATE_MODE=enforce` — a policy
  failure fails the job, and the failed validation build blocks
  completion.
- In the default report-only mode with no branch policy, nothing
  blocks: the thread and the status are advisory, exactly as
  labeled.

## Bitbucket Cloud: receipt collector + gate wrapper

The same platform-neutral core also ships Bitbucket Cloud packaging:
a receipt collector for pull requests and a Bitbucket Pipelines
wrapper for the gate. Bitbucket Cloud's REST API (2.0) is a
different API family from the forges', GitLab's, and Azure's, so the
collector is a sibling (`solvelang-bitbucket-receipt`), not a flag
on the other ones; the emitted receipt input is the same contract.
Bitbucket Data Center is a different product with a different API
and is not covered here.

### Receipt collector (`solvelang-bitbucket-receipt`)

Reads one pull request from a Bitbucket Cloud repository and emits
a Change Impact Receipt **input** object — the exact JSON shape the
Change Impact Receipts page (`site/app/change-impact-receipt`)
consumes. Paste the output into that page (or feed it to
`buildChangeImpactReceipt`) to get the receipt: findings labeled
verified / failed / unverified, the standard grading block, no risk
scores. The page itself is unchanged.

```bash
cd packages/pr-gate
npm ci
npm run build
BITBUCKET_TOKEN=<access-token> node dist/packages/pr-gate/src/bitbucket-receipt.js \
  --workspace my-workspace --repository widget-repo --pr 42 \
  --gate-result .pr-gate-out/result.json \
  --out receipt-input.json
```

- `--workspace` and `--repository` are the workspace and repository
  slugs from the PR's URL; `--pr` is the pull request id.
- The credential is supplied by the operator at runtime and is
  never stored, logged, or written to the output: `--token` takes
  an access token (repository, workspace, or project) or an OAuth
  token, sent as a bearer token (falls back to `BITBUCKET_TOKEN`),
  and `--username` with `--api-token` takes an Atlassian API token,
  sent as HTTP Basic with the account email (fall back to
  `BITBUCKET_USERNAME` / `BITBUCKET_API_TOKEN`; the bearer token
  takes precedence when both are supplied). Public repositories
  read without one.
- The collector reads the PR, its diffstat, its commit list, its
  build-status list, the current head of its destination branch,
  and the two include/exclude commit listings behind the compare.
  Every field name and enum was verified against Atlassian's REST
  API documentation
  (https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)
  and first-hand against a public repository; the mappings that
  matter:
  - The change list is the PR's own diffstat. Each entry carries a
    status (`added` / `modified` / `removed` / `renamed`) and
    Bitbucket's own per-file counts (`lines_added` /
    `lines_removed`), recorded as returned — never estimated. (The
    Azure collector records `0/0` because Azure's API carries no
    counts; Bitbucket's does.) The endpoint redirects to the
    repository diffstat; the read follows the redirect and pages
    via the standard `next` links. A removed file's path comes
    from its `old` side.
  - Bitbucket Cloud computes **no combined-tree preview** for a
    pull request — there is no merge queue in Cloud and no endpoint
    shows the tree a merge would produce — so nothing here claims
    what a merge would produce; the gate evaluates the PR head
    as-is, and the diffstat is the source read against the
    destination as Bitbucket tracks it.
  - There is **no mergeability verdict to read**: the PR object
    carries no mergeable/conflict field, and GET on the merge
    endpoint answers 405 (merging is POST-only). Merge checks are
    branch-restriction settings evaluated by Bitbucket's UI, not
    data on the PR record. `mergeable` is therefore `null` and the
    state `unknown` for every PR — no mergeability claim is made.
  - Reviews are the PR's participants and their recorded verdicts:
    the `approved` flag (state `approved`) maps to `APPROVED`, and
    state `changes_requested` maps to `CHANGES_REQUESTED`;
    participants with no verdict are dropped. Both roles
    (`REVIEWER` and `PARTICIPANT`) are mapped, because Bitbucket
    records verdicts on the participant list and its own approvals
    merge check counts participant approvals (the check itself
    excludes the author's own approval; the receipt records
    verdicts as recorded and evaluates no check). The separate
    `reviewers` list names who was asked and carries no verdicts.
  - CI evidence is the PR's build-status list — the build statuses
    Bitbucket attaches to the pull request (the statuses of its
    latest commit), read through
    https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/.
    Statuses are keyed and a repost overwrites, so the list is
    already the newest word per key. States map: `SUCCESSFUL` →
    success, `FAILED` → failure, `INPROGRESS` → in progress,
    `STOPPED` → cancelled. The name is the status's display name,
    falling back to its key.
  - The PR object abbreviates commit hashes, so the full head SHA
    is the first entry of the PR's commits list (newest first),
    falling back to `source.commit` as returned; the full current
    destination head is read from the branch ref
    (`GET /refs/branches/{branch}` → `target.hash`). If the branch
    cannot be read (for example it was deleted after the PR
    closed), the base falls back to the PR's `destination.commit`
    exactly as returned (abbreviated) and the compare is skipped —
    drift against the current base is then not established.
  - The compare has no endpoint with counts: `aheadBy` /
    `behindBy` are the lengths of the commit listings read with
    `include` / `exclude` (head against current base, and the
    reverse), each paged in full. If either listing cannot answer,
    `compare` is `null` and the builder labels base drift
    unverified.
  - The PR object carries `task_count` and `comment_count`; the
    receipt contract has no field for them, so they are not
    carried. (`task_count` is the count the "No unresolved pull
    request tasks" merge check reads.)
- If any required read fails (PR, diffstat, commits, statuses),
  the collector exits `2` (operational error) rather than emitting
  a partial input the builder would over-claim from.
- `--gate-result` embeds a PR Gate `result.json`
  (`solvelang.pr-gate.result.v1`) as the receipt's PR Gate route.
  With no result supplied, the route is recorded as not run — which
  the builder labels failed, never silently dropped.

Exit codes mirror the PR Gate CLI: `0` = input emitted, `2` =
operational error.

### Gate pipeline template

- `workflow-template.bitbucket-pipelines.yml` — copy to
  `bitbucket-pipelines.yml` (or merge the step into your existing
  `bitbucket-pipelines.yml`).

The pipeline runs for pull requests on the workspace's own runners
or Bitbucket's cloud, reads the PR facts (head SHA, changed files)
from the API — the PR's diffstat, since a pull-request pipeline
checks out a merge commit, not the head — runs the same core CLI in
report-only mode by default (`PR_GATE_MODE`), posts/updates ONE
sticky PR comment (marker `<!-- pr-gate:report -->`) through the
comments API, and posts a build status on the head commit through
the commit statuses API with the fixed key `solvelang-pr-gate`, the
name "SolveLang PR Gate", and `refname` set to the source branch —
the field Atlassian documents for associating a commit status with
a pull request. Posting the same key again overwrites the previous
status, so the newest post is the record. The status is mapped from
the verdict recorded in `result.json`, never from the CLI exit
code: in report-only mode the CLI exits 0 even on a policy FAIL,
and the status says so ("advisory only"). Bitbucket's states are
`SUCCESSFUL` / `FAILED` / `INPROGRESS` / `STOPPED` — there is no
error state, so an operational failure posts `FAILED` with a
description that says it was operational. Bitbucket pull requests
have no labels, so the gate runs with no `--labels` and label-based
policy rules see an empty label set. Comment and status posts are
best-effort — Bitbucket Pipelines gives a step no ambient
credential for the repository API, so without `PR_GATE_TOKEN` (an
access token with Repositories: Write and Pull requests: Write,
defined as a secured repository variable) the posts are skipped
with a warning and the report still lands in the job log and the
`.pr-gate-out` artifacts; the step's exit code is governed by the
gate verdict and `PR_GATE_MODE` only.

**What blocks a merge on Bitbucket Cloud — stated exactly, because
the strength lives in the workspace plan and branch settings, not
in this template**
(https://support.atlassian.com/bitbucket-cloud/docs/suggest-or-require-checks-before-a-merge/):

- The build status this template posts is one of the build
  statuses on the PR's last commit, and Bitbucket's built-in merge
  check **Minimum number of successful builds for the last commit
  with no failed builds and no in progress builds** counts exactly
  those statuses: a `FAILED` status under our key leaves that check
  unresolved, and a `SUCCESSFUL` one counts toward the minimum.
  Custom merge checks (Forge apps) can also evaluate pull
  requests; this template installs none.
- On the Free and Standard plans, unresolved merge checks only
  warn — the merge still proceeds. Blocking requires Bitbucket
  Cloud **Premium** and the branch setting
  **Prevent a merge with unresolved merge checks**. Read the plan
  and the branch settings,
  not the status, as the gate.
- Cloud has no per-key required-builds gate (named build keys that
  must pass are a Bitbucket Data Center feature): no Cloud setting
  makes this one key, by name, a merge requirement — the builds
  merge check counts the commit's statuses as a set.
- In the default report-only mode with no merge checks configured,
  nothing blocks: the comment and the status are advisory, exactly
  as labeled.
