# Studio account saving

Backend deployed on 2026-09-20 at main `632b6ff82f2f54babe46e4e11e672675e4ca838e`
in [run 35531150309](https://github.com/saiidz/solvelang/actions/runs/35531150309).
Parameter/health preservation and unauthenticated 401 acceptance passed.
Authenticated two-account acceptance passed 6/6 on 2026-09-27 using the
protected acceptance surface and harness at main
`62da3f46b05c0449dce071f04729cf6d8e561616`. Canonical production
account-saving controls remain off pending the reviewed rollout.

On 2026-09-23, PR [#954](https://github.com/saiidz/solvelang/pull/954) merged
as `e4273de61151f4e703b4ef15c736f334460b9759`; exact-head CI passed before
the protected maintenance execution in
[run 35929234257](https://github.com/saiidz/solvelang/actions/runs/35929234257).
That execution configured `StudioAcceptanceOrigin` to exactly
`https://studio-acceptance.d3j3fgk4gcxxg2.amplifyapp.com` and preserved the
existing stack parameters. A production preflight returned 204 with that exact
origin, credentials enabled and the configured methods/headers. An unrelated
origin received no CORS allow headers, and an unauthenticated workspace GET
still returned 401. The acceptance hostname returns 401 with Basic
authentication when requested without credentials. Those 2026-09-23 checks
preceded the authenticated 2026-09-27 acceptance run; the canonical Studio
account-saving controls remain gated.

Studio remains local-first. Sign-in alone never uploads existing local workflows.
The Projects view lets a signed-in user connect, inspect the account snapshot,
export it, open a saved project as a new local copy, or explicitly replace the
account snapshot and enable autosave for the current Studio session.

The snapshot includes projects, versions and traces. Local usage counters are
excluded. Maximum: 50 projects and 256 KiB of JSON including history per account.
Oversized snapshots are rejected without trimming or losing local data.

`GET /customer/studio/workspace` and `POST /customer/studio/workspace` use the
existing guarded account session. Writes require CSRF and the expected account
identity. A conditional revision prevents lost updates between devices. Conflicts,
expired sessions, network failures and switched accounts pause autosave and keep
local work. Reconnect to inspect the current remote snapshot before retrying.

One namespaced record in the existing encrypted customer-auth DynamoDB table holds
the snapshot. No new credentials, public bucket, or provider calls are introduced.
JSON is stored as a bounded string. Removing a snapshot writes an empty snapshot
with an incremented revision so a stale browser cannot resurrect it silently.
This removes the current account copy, not retained infrastructure backups.

## Deployment acceptance

Use a reviewed deployment that preserves existing account, TOTP and billing
configuration. Do not use the legacy billing-off customer-account deployment for
this maintenance change. Deploy the API code and both SAM routes before claiming
account saving is available; site auto-deployment alone is insufficient. Keep
the production build selector unset on `main` until the reviewed enablement.

Verify with two disposable test accounts: account A saves and restores in another
browser; account B cannot read A; stale revisions return 409; sign-out/account
switching does not transfer a pending save; offline errors preserve local work;
export, account-snapshot removal, and exact restoration work. No customer project should be used as
test data. Test environment proof and production acceptance are separate records.

### Deterministic acceptance harness

`site/qa/studio-account-acceptance.mjs` launches two explicitly labeled,
persistent Playwright profiles under `STUDIO_ACCEPTANCE_RUN_DIR` (or a temporary
run directory): `Account A` and `Account B`. The process stays alive while each
profile is authenticated, then privately compares one-way account digests and
fails closed if either profile is unauthenticated, both resolve to the same
account, or the identities do not exactly match three required, distinct
`STUDIO_ACCEPTANCE_OWNER_ACCOUNT_DIGEST`,
`STUDIO_ACCEPTANCE_DISPOSABLE_ACCOUNT_A_DIGEST`, and
`STUDIO_ACCEPTANCE_DISPOSABLE_ACCOUNT_B_DIGEST` values. Each value is the
lowercase SHA-256 digest of the corresponding private account ID; never put
raw IDs or credentials in command history or evidence.
Magic-link navigation in another profile cannot satisfy the waiting context.

Do not run the harness from PR #957: its final check empties Account A's
snapshot without restoring it. Before running the repaired harness, establish
whether earlier acceptance removed any projects by checking preserved browser
storage, persistent profiles, downloaded account backups, and the production
table's PITR window. Keep all such material intact. Production recovery requires
separate owner authorization; restore to an isolated table first where possible.

The repaired harness refuses to write if either account or browser profile
contains non-acceptance projects. A new persistent profile may contain the
Studio-generated support-triage starter; a digest of its document, versions,
and traces is recorded privately before authentication, and only that unchanged
starter is permitted afterward. It saves private, mode-0600 pre-run workspace
backups and a copy of the account export in the mode-0700 run directory, verifies the export against the
exact prior snapshot, removes only a qualified disposable account snapshot,
restores it even after a removal failure, and verifies that browser-local data
did not change. It also restores both accounts to their pre-run snapshots after
the six checks. Preserve the run directory and backups if restoration fails.

The harness writes only sanitized outcomes to
`STUDIO_QA_EVIDENCE_PATH` (defaulting to a temporary file outside the repository). It never
emits cookies, tokens, passwords, CSRF values, account IDs, or workspace
contents in logs or evidence. Private recovery backups are separate from sanitized
evidence. Supply `STUDIO_QA_NODE_MODULES` with an isolated Playwright install and
run `node site/qa/studio-account-acceptance.mjs` only against the protected
acceptance origin. Production account saving remains disabled.

## Isolated production acceptance surface

The repository prepares a dedicated Amplify branch named `studio-acceptance`.
Its build emits account-saving controls only when `AWS_BRANCH` is exactly
`studio-acceptance` and the branch-only Amplify variable
`STUDIO_ACCEPTANCE_PREVIEW_ENABLED=true` is set. The build wrapper strips both
public Studio flags before evaluating its branch selectors, so an app-wide
public flag cannot enable account saving. Normal production controls require
`AWS_BRANCH=main`, the explicit branch-only
`STUDIO_PRODUCTION_ACCOUNT_SAVING_ENABLED=true` selector, and the verified
production API base URL. That selector is currently unset. It never enables
the acceptance preview label on `main`; the acceptance UI remains labeled
disposable-data-only.

The public build variable is a build selector, not an access control. Before
setting it, restrict the `studio-acceptance` branch with Amplify's per-branch
password access control. The branch URL follows
`https://studio-acceptance.<Amplify app ID>.amplifyapp.com`.
The build also fails closed unless `NEXT_PUBLIC_API_ACCESS_BASE_URL` exactly
matches the production API endpoint verified in the current readiness record.

The production API currently accepts that exact generated branch origin through
the `StudioAcceptanceOrigin` stack parameter, deployed in maintenance run
35929234257. Live preflight checks confirmed that origin and the canonical site
origin are accepted; an unrelated origin receives no allow headers. No wildcard,
custom host, path, or second origin is configured. The existing `SITE_ORIGIN`, partitioned
session cookie, CSRF token, account binding, and revision checks remain in force.
When a magic-link request comes from the exact configured acceptance branch, its
link returns to that branch so the partitioned session stays in the same browser
site partition. Requests without an origin retain the canonical-site callback.

Repository code does not create the branch, configure its password, or turn on
its branch-only build variable. The protected branch completed all six real
acceptance checks on 2026-09-27: save/restore, A/B isolation, stale-revision
conflict, sign-out/account switching, offline local preservation, and
export/removal/restoration. Two fresh qualified disposable accounts were used;
their pre-run snapshots were restored and browser-local work survived. The
sanitized evidence is retained outside the repository. The canonical site
remains gated until the production rollout is approved and verified.

## Validation source

The browser schemas in `site/app/studio/core/{types,schema,workspace-schema}.ts`
are canonical. The API ships generated JavaScript from those exact sources.
After changing a schema, run `node services/api-access/scripts/generate-studio-schema.mjs`
with the site dependencies installed. API CI checks source fingerprints and rejects
stale generated validators. Both runtimes use Zod 4.4.3 for this contract.
