# Studio account saving

Backend deployed on 2026-09-20 at main `632b6ff82f2f54babe46e4e11e672675e4ca838e`
in [run 35531150309](https://github.com/saiidz/solvelang/actions/runs/35531150309).
Parameter/health preservation and unauthenticated 401 acceptance passed.
Authenticated two-account acceptance is still pending; frontend controls remain off.

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

The production API accepts that exact generated branch origin only when the
optional `StudioAcceptanceOrigin` stack parameter is set. It accepts no wildcard,
custom host, path, or second origin. The existing `SITE_ORIGIN`, partitioned
session cookie, CSRF token, account binding, and revision checks remain in force.
When a magic-link request comes from the exact configured acceptance branch, its
link returns to that branch so the partitioned session stays in the same browser
site partition. Requests without an origin retain the canonical-site callback.

These repository changes do not create the branch, configure its password, turn
on its branch-only build variable, or deploy the API origin. Complete the six
real acceptance checks on that isolated surface before considering any broader
release. The canonical site remains gated.

## Validation source

The browser schemas in `site/app/studio/core/{types,schema,workspace-schema}.ts`
are canonical. The API ships generated JavaScript from those exact sources.
After changing a schema, run `node services/api-access/scripts/generate-studio-schema.mjs`
with the site dependencies installed. API CI checks source fingerprints and rejects
stale generated validators. Both runtimes use Zod 4.4.3 for this contract.
