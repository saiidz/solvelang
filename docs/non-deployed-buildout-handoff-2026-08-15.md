# SolveLang non-deployed buildout handoff — 2026-08-15

This document is the review handoff for the owner-approved **build-only** work completed after the production account-access canary. It is deliberately separate from production rollout authorization.

## Hard boundary

The build authorization covered isolated branches, code, tests, documentation, draft pull requests, and hosted CI only.

It did **not** authorize:

- merging a buildout PR into production solely because it is green;
- deploying the API, site, admin console, queue, KMS, or any other stack;
- changing live AWS resources, Stripe configuration, SES configuration, or customer data;
- enabling billing, paid priority, CRM, Server Audit uploads, or authenticator 2FA;
- sending email;
- performing a real customer priority job.

The production source-of-truth commit remains:

```text
7975a122d14db2d424d7c5c3bc2829506bc9b552
```

## Current production truth

At the time this buildout was prepared:

- API access: **enabled**
- customer accounts: **enabled**
- password sign-in: **enabled and canary-proven**
- account status lookup by email/username/account ID: **enabled and canary-proven**
- account suspension/reactivation: **enabled and canary-proven**
- subscription billing: **disabled**
- Stripe production credentials injected: **no**
- charges performed: **no**
- paid priority/customer priority selector: **disabled**
- authenticator 2FA: **disabled**
- Admin CRM: **not deployed / disabled**
- private admin console: **not deployed**
- Server Audit v0: **not deployed**

The live GitHub OIDC roles already received the reviewed TOTP supplemental IAM policies under a separate explicit owner approval. That IAM gate did not create a KMS key and did not enable TOTP. A later owner approval for TOTP KMS stack creation was given, but this handoff does not claim that KMS creation succeeded unless a successful workflow result is separately recorded.

## Production canary accounts

Owner account:

```text
email: saiidzeidan@gmail.com
username: saiidz
account: acct_b234472a01a209f69aadac7f145c2dbe
```

Reusable disposable production canary:

```text
email: saiidzeidan+solvelang-canary-20260814@gmail.com
username: solvelang-canary-20260814
account: acct_057fb03877f724c15c8b4b54af034ead
```

The disposable canary proved:

1. first-sign-in email verification;
2. canonical account lookup;
3. active -> suspended transition;
4. existing-session invalidation;
5. suspended -> active reactivation;
6. recovery access after reactivation;
7. password setup;
8. username/password sign-in without additional email.

Keep its password private and keep the account active unless a later canary explicitly needs a reversible suspension.

---

# Review set

## PR #151 — Private customer CRM + operations console

Branch:

```text
agent/admin-crm-foundation
```

Pull request:

```text
https://github.com/saiidz/solvelang/pull/151
```

Status for review: **draft; hosted validation completed green before this handoff**.

Built backend capabilities:

- exact customer lookup by canonical account ID, email, or username;
- account access state + `authVersion` visibility;
- safe authentication posture summary;
- plan/subscription/usage summary;
- API-key metadata without key secrets/fingerprints;
- CRM profile with stage, priority, owner, company, tags, summary, and next action;
- bounded notes;
- bounded tasks;
- immutable CRM activity entries;
- server-side account suspend/reactivate/strongly-confirmed termination path using canonical account ID.

Sensitive values intentionally excluded from CRM responses:

- password hashes and salts;
- TOTP ciphertext;
- backup-code fingerprints;
- API-key secret fingerprints;
- Stripe customer/subscription IDs;
- secret configuration.

Infrastructure contract:

- `AdminCrmEnabled=false` by default;
- CRM requires API access + customer accounts;
- dedicated DynamoDB table is conditional, encrypted, PITR-enabled, and retained on delete/replacement;
- API-key authorizer receives no CRM table access;
- billing remains independently disabled.

Private `admin-console/` app:

- separate from the public static site;
- API admin secret remains server-only;
- independent scrypt admin password;
- independent HMAC-signed bounded session;
- HttpOnly + SameSite=Strict cookie;
- exact-Origin checks on browser mutations;
- bounded login throttling;
- customer lookup/access/CRM/usage/key-metadata/audit UI;
- irreversible termination requires exact `TERMINATE <account_id>` confirmation.

No admin console host, DNS record, secret, CRM table, or CRM feature flag was created in production by the buildout.

## PR #152 — Server Audit v0

Branch:

```text
agent/server-audit-v0
```

Pull request:

```text
https://github.com/saiidz/solvelang/pull/152
```

Status for review: **draft; hosted validation completed green before this handoff**.

Built product:

- `/server-audit/` local-first workspace;
- bounded versioned snapshot parser;
- deterministic server posture findings;
- stable finding IDs;
- score/severity summary;
- local JSON and portable HTML report export;
- Resources/sitemap route registration;
- versioned snapshot/report schemas;
- read-only Linux evidence collector;
- collector safety regression tests.

Deterministic checks include:

- filesystem capacity;
- sensitive/unexpected listeners bound to all interfaces;
- SSH root/password posture;
- firewall posture;
- automatic update posture;
- TLS expiry;
- web-root permissions/ownership review;
- backup evidence absence/staleness;
- very large logs;
- unhealthy services;
- redaction/coverage gaps.

v0 intentionally does not:

- accept SSH credentials;
- execute remediation;
- write to the inspected host;
- upload the snapshot to SolveLang;
- read environment variables/private keys/credential contents/database or customer contents/process command lines/cron command bodies;
- claim a package version is vulnerable without a vulnerability source;
- treat a clean report as a penetration test or certification.

## PR #153 — closed/superseded provenance attempt

Pull request:

```text
https://github.com/saiidz/solvelang/pull/153
```

Status: **closed without merge or deployment**.

Why it was closed:

- the first implementation replaced `solvec/src/main.rs` against an incorrect/older CLI shape;
- hosted Rust validation correctly exposed the mismatch;
- the branch was force-reset to current `main` rather than preserving dead module references;
- the review artifact was closed explicitly so it cannot be mistaken for a valid implementation.

The real remaining language gap is narrower: imports are flattened into one source string, so parser/runtime diagnostics can retain a global line number but lose the imported file identity/local line. The correct design is a line-level source map at the import-loader/CLI boundary, without changing AST serialization or runtime public formats. Publish that only as a clean replacement branch against current `main`.

## PR #154 — Customer priority / launch tooling

Branch:

```text
agent/customer-priority-launch-tooling
```

Pull request:

```text
https://github.com/saiidz/solvelang/pull/154
```

Status for review: **draft; keep unwired and non-deployed until its latest hosted CI is green and reviewed**.

Built customer-facing service layer:

- active-account-gated priority quote;
- base-credit calculation from the existing token envelope;
- reviewed lane multipliers: normal 1x, express 2x, priority 5x, critical 10x;
- deterministic weighted-credit quote;
- authenticated-session customer ownership;
- CSRF verification for mutations;
- deterministic customer job ID from account + request ID;
- source SHA-256 fingerprint contract rather than source contents in this layer;
- exact request idempotency;
- weighted-credit consumption through the existing idempotent usage ledger;
- customer-owned `repository_audit` queue record;
- ownership-safe job status;
- account re-verification at worker execution time;
- explicit injected customer-job executor; without a real executor the worker fails closed.

Three independent launch gates are required:

1. queue foundation enabled;
2. customer priority exposure enabled;
3. provider/customer execution enabled.

The branch deliberately does not:

- wire customer priority routes into the production SAM API;
- enable the priority queue;
- add provider credentials;
- add source upload/storage;
- expose a customer UI selector;
- enable Stripe/live billing;
- submit a real job;
- consume production credits;
- deploy anything.

---

# Existing product foundations already on main

These were not rebuilt from scratch during this buildout:

- Workflow Intelligence Studio / workflow analysis foundations;
- Repository Audit local-first ZIP/TAR inspection and report integrity hardening;
- weighted priority queue lanes/workers/canaries;
- customer password authentication;
- account state enforcement;
- protected production account admin workflow;
- TOTP application code and rollout/IAM preparation;
- billing lifecycle/test-mode implementation and replay hardening.

## Remaining non-deployment engineering item

Before calling the non-deployed buildout complete, publish and validate the clean imported-file provenance replacement described above. Do not resurrect PR #153 as-is.

## Recommended review order tomorrow

1. **#151 Admin/CRM** — privileged product surface; review data minimization, access controls, auditability, termination guard, IaC default-off behavior.
2. **#152 Server Audit** — review collector allowlist/omissions, parser bounds, finding semantics, local-only guarantees.
3. **#154 Customer priority tooling** — review credit/idempotency/order/account-execution boundaries and verify latest hosted CI.
4. **clean provenance replacement** — review only after it is based on the current real CLI and passes Rust CI.
5. **handoff/truth PR** — update this document with final PR heads/CI results before any merge decisions.

## Deployment gates remain separate

Even after code review/merge, production enablement remains separately gated. In particular:

- Admin/CRM requires a reviewed private deployment/origin/access-layer design and explicit CRM enablement.
- Server Audit can ship as a static/local product, but a future remote collector/upload/remediation capability requires a separate safety review.
- Customer priority requires queue canary proof, a real bounded provider executor, source-storage contract, stop thresholds, usage proof, and separate customer/billing release decisions.
- Billing remains OFF until a distinct live Stripe/billing rollout is approved and validated.
- TOTP remains OFF until the dedicated KMS/preflight/deployment/enrollment sequence is separately completed and evidenced.

No statement in this document authorizes deployment.
