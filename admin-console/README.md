# SolveLang Admin Console

Private, server-rendered customer operations and CRM console. It is intentionally separate from the public static site.

## Security model

- the browser never receives `SOLVELANG_ADMIN_API_SECRET`;
- all production API calls are proxied server-side;
- the console has its own scrypt password and independent HMAC session secret;
- sessions are HTTP-only, SameSite=Strict, bounded to eight hours, and signed;
- browser mutations require an exact configured Origin;
- login failures are bounded per source in-process; production ingress should add an external identity/access layer and rate limiting as defense in depth;
- customer detail responses explicitly omit password hashes/salts, TOTP ciphertext, backup-code fingerprints, Stripe customer/subscription IDs, API-key fingerprints, and all secret values;
- account access mutations always use the canonical `acct_...` ID already resolved by the backend;
- termination remains irreversible and requires exact `TERMINATE <account_id>` confirmation;
- CRM writes produce immutable audit entries;
- exact customer lookup is read-only and never auto-creates a CRM record.

## Local setup

```bash
cd admin-console
npm install
npm run hash-password -- 'choose-a-strong-admin-password'
cp .env.example .env.local
# fill server-only values
npm run dev
```

Do not reuse the customer password, customer-auth pepper, API-key pepper, or any Stripe secret as the admin-console password/session secret.

## Required backend feature

The API stack must eventually be deployed with `AdminCrmEnabled=true` and the dedicated CRM DynamoDB table wired to the API Lambda. This repository branch only builds the code and infrastructure contract; it does not authorize or perform a deployment.

## Product scope

- exact customer lookup by email, username, or account ID;
- access state and auth-version visibility;
- reversible suspension/reactivation and strongly confirmed termination;
- safe authentication posture summary;
- subscription/plan and credit usage summary;
- API key metadata without secret material;
- CRM stage, priority, ownership, company, tags, summary, next action;
- notes and tasks;
- immutable CRM activity timeline.

Future production deployment should place this console on a private origin (for example `admin.solve-lang.com`) behind an external access-control layer in addition to the application login.
