# Studio account saving

Implementation candidate, not yet deployed or live-verified.

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
account saving is available; site auto-deployment alone is insufficient. Keep `NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED` unset until the backend acceptance checks pass, then set it to `true` and rebuild the site.

Verify with two disposable test accounts: account A saves and restores in another
browser; account B cannot read A; stale revisions return 409; sign-out/account
switching does not transfer a pending save; offline errors preserve local work;
export and account-snapshot removal work. No customer project should be used as
test data. Test environment proof and production acceptance are separate records.

## Validation source

The browser schemas in `site/app/studio/core/{types,schema,workspace-schema}.ts`
are canonical. The API ships generated JavaScript from those exact sources.
After changing a schema, run `node services/api-access/scripts/generate-studio-schema.mjs`
with the site dependencies installed. API CI checks source fingerprints and rejects
stale generated validators. Both runtimes use Zod 4.4.3 for this contract.
