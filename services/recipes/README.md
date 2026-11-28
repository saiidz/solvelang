# SolveLang Recipes service (Stage 0 — packaging layer)

The packaging layer for the SolveLang recipes program: one catalog,
one per-repo config, one scheduler, graded receipts for every run.
Stage 0 shipped the machinery only. Stage 1 adds the first real
executor (license-headers, see below); a recipe is proven or
claimed to work only when its registry flag flips on proof.

## Pieces

- `src/registry.js` — the catalog registry: the 8 program recipes
  (license-headers, import-organization, lint-autofix,
  error-message-refactors, matrix-monorepo-analysis,
  dependency-secret-scanner, code-review, security-review), each with
  trigger classes (pull_request / schedule / manual) and a
  least-privilege execution identity class (verification-app /
  process-solution-app / scan). Every recipe starts `proven: false`;
  `publicCatalog()` stays empty until a later stage's proof flips a
  flag. Internal test-only recipes may be registered by wiring code
  and never appear in the catalog.
- `src/config.js` — `.github/solvelang-recipes.json`
  (`{version: 1, recipes: {<id>: {enabled, cadence/trigger, options}}}`),
  read at the PR base SHA exactly like the verification config. An
  invalid file yields safe defaults (all recipes off) **plus** a
  visible note carried into every run record and receipt — never a
  silent downgrade.
- `src/scheduler.js` — per-repo schedule registry + firing loop
  (digest/runners timer precedent) and the pull_request dispatch
  entry point. Every firing is recorded as a run record.
- `src/runner.js` — one execution end to end: registry lookup,
  base-SHA config read, enablement check (a disabled recipe records a
  *skipped* run, visibly), executor call, graded receipt, MGOV audit.
- `src/receipt.js` — graded receipts (verified / failed /
  unverified). A `verified` label requires observed evidence;
  `falseVerifiedLabel` is always false. Metering records duration +
  executor inputs only — no pricing, no charges, no Stripe.
- `src/audit.js` — MGOV audit client (`POST /recipes/audit` in
  saiidz/solvelang-merge-governance), fail-closed like the
  verification audit client.
- `src/license-headers.js` — the Stage 1 license-headers executor
  (deterministic, no model calls): check mode grades every scanned
  source file verified / failed / unverified against the header
  template in the repo config's options; fix mode opens ONE fix PR
  with header-only changes under the injected token's actual
  identity (its real author login is stated in the receipt finding).
  Header rule: the exact configured template at the file head,
  allowing only a UTF-8 BOM and/or one shebang line before it.
- `src/fix-dispatch.js` — MGOV fix-dispatch client
  (`POST /recipes/fix-dispatch` in saiidz/solvelang-merge-governance),
  admin-token auth identical to the audit client, fail-closed like
  it. Used by fix mode in dispatch mode (below).
- `src/github.js` — the small GitHub REST surface the executor
  needs (tree listing, file bytes at a ref, one Git-Data fix PR),
  token injected by the wiring; production tokens are SolveLang
  Process Solution App installation tokens supplied via
  RECIPES_GITHUB_TOKEN / RECIPES_GITHUB_TOKEN_FILE.
- `src/server.js` — HTTP wiring: `GET /health`, admin-gated
  `POST /dispatch/manual`, `POST /dispatch/pull-request`,
  `POST /register`, `POST /tick`, plus the internal tick timer
  (`RECIPES_TICK_MS`, default 60s; 0 disables). The default executor
  honestly reports itself unbuilt (one unverified finding).

## Architecture choice

A library + small service entry in its own package, rather than a
module inside the verification service: the scheduler fires
executions under three different identity classes (only one of which
is the Verification App), the cadence loop is a new always-on
concern the per-PR verification service does not have, and a
separate package keeps the live verification service untouched while
the packaging layer proves itself. The patterns (config at base SHA,
verdict grading, annotation-free receipt discipline, MGOV audit,
fail-closed admin gates) are the verification service's, reused.

## Run / test

## Fix delivery modes (license-headers fix mode)

Fix mode computes its header-only changes deterministically, exactly
the same in both modes; only PR delivery differs:

- **Direct mode (default):** the executor opens the fix PR itself via
  GitHub REST under the injected token (`RECIPES_GITHUB_TOKEN` /
  `RECIPES_GITHUB_TOKEN_FILE`), and the receipt finding states that
  token's actual author login.
- **Dispatch mode (`RECIPES_FIX_VIA_MGOV=1`):** the executor sends
  the changes to MGOV's `POST /recipes/fix-dispatch` as
  `contentBase64` per changed file, on branch
  `solvelang-recipes/<recipeId>/<first 8 of runId>`. MGOV opens the
  PR through its governed batch path as
  `solvelang-process-solution[bot]` — the process-solution-app
  identity class the registry records for this recipe — and the
  author login MGOV returns is the one recorded in the receipt
  finding. There is **no silent fallback**: if dispatch fails or is
  unconfigured, the run's fix outcome is graded honestly (an
  unverified finding carrying the dispatch error code, conclusion
  failure) and no PR is opened under any other identity.
  `RECIPES_TENANT_ID` (or a per-dispatch `tenantId`) is forwarded
  when set so MGOV can verify the tenant binds the repo.

```sh
npm test          # node --test test/*.test.js
npm start         # node src/server.js (RECIPES_PORT, RECIPES_ADMIN_TOKEN,
                  # RECIPES_MGOV_BASE, RECIPES_MGOV_ADMIN_TOKEN, RECIPES_TICK_MS,
                  # RECIPES_FIX_VIA_MGOV, RECIPES_TENANT_ID)
```

The Docker image builds from the repo root, like the verification
service's (`services/recipes/Dockerfile`).
