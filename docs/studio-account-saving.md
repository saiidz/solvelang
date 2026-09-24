# Studio account saving

Backend deployed on 2026-09-20 at main `632b6ff82f2f54babe46e4e11e672675e4ca838e`
in [run 35531150309](https://github.com/saiidz/solvelang/actions/runs/35531150309).
Parameter/health preservation and unauthenticated 401 acceptance passed.
Authenticated two-account acceptance is still pending; frontend controls remain off.

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
authentication when requested without credentials. The protected build has not
been inspected past that password gate; none of the six authenticated
acceptance checks has been performed. The canonical Studio account-saving
controls remain gated.

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
`NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED` unset on `main`.

Verify with two disposable test accounts: account A saves and restores in another
browser; account B cannot read A; stale revisions return 409; sign-out/account
switching does not transfer a pending save; offline errors preserve local work;
export and account-snapshot removal work. No customer project should be used as
test data. Test environment proof and production acceptance are separate records.

### Deterministic acceptance harness

`site/qa/studio-account-acceptance.mjs` launches two explicitly labeled,
persistent Playwright profiles under `STUDIO_ACCEPTANCE_RUN_DIR` (or a temporary
run directory): `Account A` and `Account B`. The process stays alive while each
profile is authenticated, then privately compares one-way account digests and
fails closed if either profile is unauthenticated, both resolve to the same
account, or a configured `STUDIO_ACCEPTANCE_OWNER_ACCOUNT_DIGEST` matches.
Magic-link navigation in another profile cannot satisfy the waiting context.

The harness then runs the six checks and writes only sanitized outcomes to
`STUDIO_QA_EVIDENCE_PATH` (defaulting to a temporary file outside the repository). It never
reads or emits cookies, tokens, passwords, CSRF values, account IDs, or workspace
contents. Supply `STUDIO_QA_NODE_MODULES` with an isolated Playwright install and
run `node site/qa/studio-account-acceptance.mjs` only against the protected
acceptance origin. Production account saving remains disabled.

## Isolated production acceptance surface

The repository prepares a dedicated Amplify branch named `studio-acceptance`.
Its build emits account-saving controls only when `AWS_BRANCH` is exactly
`studio-acceptance` and the branch-only Amplify variable
`STUDIO_ACCEPTANCE_PREVIEW_ENABLED=true` is set. The build wrapper removes both
public Studio flags from every other branch, including `main`, even if an
app-wide public flag was configured accidentally. The acceptance UI labels the
surface as disposable-data-only.

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
its branch-only build variable. The current branch URL is protected by Basic
authentication, but its build contents have not been verified past that gate.
Complete the six real acceptance checks on that isolated surface before
considering any broader release. The canonical site remains gated.

## Validation source

The browser schemas in `site/app/studio/core/{types,schema,workspace-schema}.ts`
are canonical. The API ships generated JavaScript from those exact sources.
After changing a schema, run `node services/api-access/scripts/generate-studio-schema.mjs`
with the site dependencies installed. API CI checks source fingerprints and rejects
stale generated validators. Both runtimes use Zod 4.4.3 for this contract.
