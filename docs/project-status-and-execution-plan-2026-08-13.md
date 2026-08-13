# SolveLang Project Status and Execution Plan

**Status date:** 2026-08-13  
**Repository:** `saiidz/solvelang`  
**Production-tested main before this documentation/preflight PR:** `54efb11ff240d9a1cf3ce14e05778ee97716021c`  
**Current password-auth preflight PR:** #139  
**Current PR #139 head before this documentation-only commit:** `fbde6a46750e76d106b81b26b3a613669c4e021f`

> This document is a status record and execution plan. It is **not** authorization to merge, deploy, enable billing, configure Stripe, send email, charge customers, modify production data, or perform destructive account actions.

## Executive summary

SolveLang has moved beyond a repository-only prototype in several areas, but it is not yet a finished self-service paid SaaS product.

The language/runtime, CLI, deterministic Studio tooling, website, CI, AWS production API foundation, customer accounts, and magic-link authentication are working. Production API access and production customer accounts are already enabled. Subscription billing remains intentionally disabled.

Username/email + password authentication was implemented in PR #138, security-hardened, tested, merged into `main`, and passed all post-merge checks. It is **merged but not yet intentionally deployed to production**.

The immediate rollout blocker was not the password-auth implementation. The previous production customer-account preflight was correctly designed for the original pre-enable state (`false/false/false`) and is therefore stale for an already-live production stack. PR #139 adds a new password-auth-specific validation-only preflight for the current state (`true/true/false`).

## Current state at a glance

| Area | State | Notes |
|---|---|---|
| Rust lexer/parser/AST/interpreter | Working beta | Canonical local runtime |
| `solvec` CLI | Working | Run, validate, tokens, AST |
| Runtime safety controls | Working | Hardened/safe execution modes |
| Workflow Intelligence Studio | Working | Local-first deterministic product surface |
| Browser workflow tooling | Working | Includes deterministic preflight-style analysis |
| Website/static export | Working | CI/build green |
| AWS production foundation | Live | Production stack exists and is stable |
| Production API access | Live | Enabled |
| Production customer accounts | Live | Enabled |
| Magic-link authentication | Live | Owner canary passed |
| Customer dashboard/session/logout | Live | Canary verified |
| Username/email + password auth | Merged, not yet intentionally deployed | PR #138 merged |
| Password session-revocation hardening | Merged, not yet intentionally deployed | Auth-version based |
| Password-auth production preflight | PR #139 | Hosted CI green on corrected head before this doc commit |
| Subscription billing | OFF | Must remain disabled during auth rollout |
| Stripe subscription credentials/webhook | OFF / not authorized | Separate future phase |
| Paid self-service API subscriptions | Not live | No commercial subscription rollout yet |
| Paid priority processing | Not live | Queue-backed production enablement still separate |
| Account suspension/termination | Not implemented | Important before broad customer adoption |
| Repository Audit | Planned | Read-only deterministic v0 first |
| Server Audit | Planned | Strict read-only v0 first |
| Full hosted managed SolveLang runtime | Planned | Not a current production claim |

---

# 1. Language and runtime

## Completed

SolveLang has a functioning Rust-based language implementation and canonical AST runtime. The repository currently includes:

- lexer;
- parser;
- AST;
- interpreter/runtime;
- typed runtime values;
- CLI execution and validation;
- source-located diagnostics;
- variables and reassignment;
- strings and integer-focused arithmetic;
- booleans and comparisons;
- `if / else`;
- `while`;
- functions, parameters, and return values;
- arrays and indexing;
- objects/records and property access in the current implementation;
- relative imports;
- JSON helpers;
- experimental network/file/environment helpers;
- experimental `agent`, `instruction`, `tool`, and `ask` syntax;
- deterministic safety policies for restricted execution.

The canonical runtime path is the Rust CLI, not the browser preview.

## Important maturity boundary

The language remains an early beta. It should not yet be marketed as a mature production general-purpose language or a durable hosted orchestration platform.

## Remaining language work

Longer-term work includes:

- stable language specification;
- broader and stricter type checking;
- stronger package/module system;
- larger standard library;
- improved imported-file diagnostic provenance;
- additional providers and production integrations;
- production packaging/releases;
- hosted execution architecture;
- durability, observability, and enterprise governance.

---

# 2. Workflow Intelligence Studio and browser tooling

## Completed

The repository includes a local-first Workflow Intelligence Studio with deterministic workflow analysis rather than unverified AI-generated analysis.

Current capabilities include workflow modeling, graph inspection, scenarios, traces, quality indicators, local versions, exports, and preliminary `.solve` draft generation.

Browser tooling also supports smaller deterministic previews and preflight-style checks.

## Architectural rule to preserve

The browser model may be broader than executable SolveLang syntax. Generated `.solve` drafts must continue to be validated by the canonical Rust runtime.

---

# 3. Production infrastructure hardening

A substantial amount of work completed before customer enablement was production infrastructure and least-privilege hardening.

## Completed categories

- deterministic region-safe artifact bucket naming;
- S3 public-access blocking, encryption, and versioning controls;
- corrected S3 IAM action naming;
- CloudFormation/SAM transform permissions;
- SAM-generated IAM execution-role name coverage;
- generated Lambda name coverage;
- API Gateway V2 tagging permissions;
- narrowed/scoped API Gateway tagging endpoint permissions;
- production stack deployment gates;
- protected GitHub production environment usage;
- separate preflight and deploy roles;
- stack state validation;
- production operations baseline re-verification;
- rollback support;
- cross-workflow production deployment serialization;
- attempt-aware production queue ordering.

## PR #137 deployment safety

PR #137 fixed critical production-deployment safety issues.

The production queue now treats workflow attempts distinctly rather than relying only on `GITHUB_RUN_ID`. Ordering uses attempt-aware start metadata and deterministic tie-breaking so reruns do not incorrectly race newer deployments.

The production deployment also captures the exact pre-deploy API/customer-account feature state and restores that captured state on post-deploy rollback while keeping subscription billing disabled.

This is important because production is already enabled; a rollback must not blindly restore API/customer flags to `false`.

---

# 4. Production API access and customer accounts

## Live state

The production customer-account deployment completed successfully before PR #138.

Expected current production feature state:

```text
API_ACCESS_MODE=live
API_ACCESS_ENABLED=true
CUSTOMER_ACCOUNTS_ENABLED=true
SUBSCRIPTION_BILLING_ENABLED=false
```

Production deployment evidence:

- workflow: `Deploy API Access Production Customer Accounts`;
- successful run ID: `31661560349`;
- deployed source commit: `abb7caf5ca1e44f6aec3b137875cae128a5273d1`;
- deployment completed successfully;
- production health verification passed;
- billing-disabled webhook boundary passed;
- operations baseline was re-applied and verified;
- rollback step was not needed because the deployment succeeded.

## Billing boundary

This customer-account phase did **not** enable subscription billing.

Production customer-account deployment keeps:

```text
SUBSCRIPTION_BILLING_ENABLED=false
```

No subscription Stripe credential should be injected during password-auth rollout.

---

# 5. Production owner canary already completed

A controlled owner magic-link canary was completed after production customer-account enablement.

Verified behavior:

1. exactly one owner sign-in email was requested and received;
2. the single-use magic link authenticated successfully;
3. the customer dashboard loaded;
4. the account had no active subscription;
5. no checkout was started;
6. no API key was fabricated solely for the canary;
7. logout completed successfully;
8. refreshing after logout remained signed out.

The owner mailbox and all authentication tokens are intentionally omitted from this public repository document.

This established a working production chain of:

```text
SES magic-link delivery
  -> token verification
  -> server session
  -> customer account/dashboard
  -> logout
  -> session revocation
```

---

# 6. Password authentication — PR #138

PR #138, `feat(auth): add password primary login`, was merged into `main`.

Merge commit:

```text
54efb11ff240d9a1cf3ce14e05778ee97716021c
```

## Implemented behavior

Normal authentication becomes:

```text
username OR email + password
```

Magic link remains available for:

- initial verified-account migration;
- recovery/fallback;
- customers who have not configured credentials yet.

Routine password login sends no transactional sign-in email.

## Password security

The implementation includes:

- scrypt-based password verifiers;
- unique per-password salts;
- no plaintext password storage;
- generic invalid-credential errors;
- source throttling;
- identifier throttling;
- unique atomic username claims;
- authenticated-only credential setup;
- existing cookie/CSRF/logout boundaries.

## Session-revocation hardening

A security review found that the initial password-reset implementation would have allowed older seven-day sessions to remain valid after a password change.

That was fixed before merge.

The final model uses an account authentication version:

- sessions are bound to the account auth version;
- initial credential setup increments the version;
- password replacement increments the version;
- older sessions immediately become stale;
- only the session performing the credential change is upgraded atomically;
- older unused magic links are also bound to the old auth version and become invalid;
- malformed/mismatched versions fail closed;
- legacy versionless records migrate as version 1.

## Validation completed

Before merge:

- focused password-auth tests passed;
- full API Access CI passed;
- general CI passed;
- Rust/RustSec passed;
- SAM validation/build passed;
- review finding on stale sessions was fixed and retested.

After merge, the exact `main` merge commit also passed:

- Static site;
- API Access test;
- Rust runtime;
- `solvec`/RustSec audit and release build.

## Current deployment state

Password authentication is **merged but not yet intentionally deployed to production**.

---

# 7. Password-auth production preflight — PR #139

## Why a new preflight was required

The historical workflow `Preflight API Access Production Customer Accounts` was built for the state before first customer-account enablement.

It intentionally expects:

```text
API=false
customerAccounts=false
billing=false
```

That historical workflow should not be weakened or repurposed because it remains valid evidence for the original first-enable phase.

Production is now expected to be:

```text
API=true
customerAccounts=true
billing=false
```

Therefore PR #139 adds a phase-specific workflow:

`Preflight API Access Production Password Auth`

## New preflight validations

The new workflow is designed to verify:

- manual `workflow_dispatch` only;
- protected `api-access-production` environment;
- `main` only;
- checked-out commit matches `GITHUB_SHA`;
- production stack stability;
- current API access already enabled;
- current customer accounts already enabled;
- subscription billing still disabled;
- live `/health` state equals `true/true/false`;
- production customer frontend still targets the exact CloudFormation API base;
- auth secrets remain independent;
- SES sender remains verified;
- SES production sending access remains enabled;
- full API-access tests pass;
- SAM validates;
- SAM builds;
- `/customer/auth/password` exists in the candidate template;
- `/customer/auth/credentials` exists in the candidate template;
- scrypt password hashing remains present;
- auth-version session revocation remains present;
- production deployment queue/rollback safeguards remain present;
- subscription billing remains blocked;
- production deployment does not inject Stripe subscription secrets.

The preflight itself contains no `sam deploy`.

## PR #139 validation status before this documentation-only commit

Corrected code head:

```text
fbde6a46750e76d106b81b26b3a613669c4e021f
```

Hosted status on that head:

- CI: passed;
- API Access CI: passed;
- 179/179 API-access tests passed;
- API SAM validation/build passed;
- priority queue SAM validation/build passed;
- Rust/RustSec workflow: passed;
- automated P1 review finding about over-broad test wording was fixed;
- review thread was resolved.

The P1 concerned only a test assertion that rejected the literal string `STRIPE_SECRET_KEY` even when it appeared inside an intentional negative grep. The corrected test now rejects actual `secrets.STRIPE_*` injection references while permitting safety-check literals.

---

# 8. Billing and monetization state

## API subscription billing

**Not live.**

Customer-facing plan concepts exist in the code/UI, but production subscription billing remains intentionally disabled.

Therefore a normal customer can currently authenticate and view the account surface, but the project should not claim a complete self-service paid API subscription lifecycle is live.

## Separate Workflow Preflight payment track

The repository also contains a separate Stripe-backed entitlement/payment system for the Workflow Preflight product track.

That production payment path remains a separate launch sequence with its own requirements, including protected production configuration, live Stripe credentials, signed webhook verification, legal/identity review, durable confirmation delivery, frontend configuration, a controlled live payment, recovery verification, and refund verification.

It must not be confused with API subscription billing.

---

# 9. Priority queue state

Queue and paid-priority foundations exist, but production paid priority processing remains a separate rollout.

Do not advertise paid priority lanes as generally live until the queue-backed production worker, lane behavior, failure handling, monitoring, and customer entitlement integration are intentionally enabled and validated.

---

# 10. Account suspension and termination gap

The customer authentication system does not yet have a durable central account status such as:

```text
active
suspended
terminated
```

This should be implemented before broad customer adoption.

A proper account enforcement model should cause suspension/termination to fail closed across:

- password login;
- magic-link issuance/verification as appropriate;
- existing sessions;
- API-key authorization;
- new API-key issuance;
- checkout/subscription operations once billing exists;
- queued execution owned by the account;
- future hosted workflow execution.

Recommended account record fields include:

```text
status
reasonCode
reasonNote
suspendedAt
terminatedAt
actionedBy
updatedAt
```

Administrative actions should be audit logged and should not require manual DynamoDB record deletion.

Suspension should be reversible. Termination should prevent service access while preserving the minimum required audit/security/business records under the applicable retention policy.

---

# 11. Documentation and repository hygiene

Several repository documents predate the production customer-account rollout and now understate or misstate current maturity.

## Documentation to update after password-auth rollout

At minimum review:

- `README.md`;
- `ROADMAP.md`;
- API-access production documentation;
- customer account/authentication documentation;
- launch-readiness documentation;
- maturity labels on the public site.

The desired truthful distinction should be approximately:

```text
Production API/customer-account infrastructure: live
Magic-link authentication: live
Password auth: live only after the upcoming rollout completes
Subscription billing: not live
Paid priority: not live
Managed hosted execution: not live
```

## Stale pull requests

Two older PRs are currently superseded by later merged work and should be reviewed for closure:

- PR #127 — old API Gateway tagging draft superseded by later scoped tagging fixes;
- PR #136 — older rollback/serialization direction superseded by PR #137.

Close them only after confirming they contain no unique work that still needs preservation.

---

# 12. Remaining execution plan

The order below is the recommended execution sequence.

## Phase A — Finish PR #139

1. Keep PR #139 open until CI on the final documentation-updated head is green.
2. Confirm there are no unresolved review threads.
3. Confirm the PR remains based on the expected `main` state with no unrelated changes.
4. Request a separate merge approval.
5. Merge PR #139 only after approval.
6. Do **not** deploy as part of the merge.

Suggested approval gate:

```text
APPROVE MERGE PR #139
```

## Phase B — Run the protected password-auth production preflight

After #139 is merged and post-merge checks are green:

1. dispatch `Preflight API Access Production Password Auth` from `main`;
2. set `confirm_password_auth_preflight=true`;
3. approve the protected `api-access-production` environment when prompted;
4. verify exact `main` commit identity;
5. verify live production remains `API=true`, `customerAccounts=true`, `billing=false`;
6. verify SES/auth/front-end API-base/tests/SAM/deployment-safety checks;
7. record the non-secret workflow summary;
8. stop if any check fails.

This phase performs no deployment.

Suggested approval gate after merge:

```text
APPROVE PASSWORD AUTH PRODUCTION PREFLIGHT DISPATCH
```

## Phase C — Production backend password-auth deployment

Only after the protected preflight passes:

1. verify `main` has not moved unexpectedly;
2. verify the reviewed deployment workflow still captures the exact current feature state;
3. verify billing remains disabled;
4. verify no subscription Stripe secrets are injected;
5. dispatch the separately protected production API/customer-account deployment for the reviewed password-auth commit;
6. deploy backend password routes in place with `true/true/false` preserved;
7. verify `/health` remains `true/true/false`;
8. verify subscription webhook still fails closed;
9. re-verify production operations baseline;
10. use automatic state-preserving rollback if post-deploy verification fails.

Suggested approval gate:

```text
APPROVE PASSWORD AUTH PRODUCTION DEPLOYMENT
```

This should still authorize **no billing**.

## Phase D — Production frontend publication/verification

After backend password routes are live:

1. determine whether the production hosting platform already published the reviewed `main` commit;
2. if not, use the separately controlled static-site deployment process;
3. verify `/account/api-keys/` is serving the password-login UI;
4. verify the compiled frontend contains the exact production API base;
5. confirm no secret values are embedded in public assets;
6. do not expose password UI against an API version that lacks the password routes.

If frontend publishing requires a state-changing action outside the backend deployment, keep that as its own explicit approval boundary.

## Phase E — Owner password-auth canary

After backend and frontend both match the reviewed release:

1. use the existing magic-link path for the approved owner account;
2. verify the same account/dashboard loads;
3. configure a unique username and strong password;
4. sign out;
5. note the current mailbox message count;
6. sign in with username or email + password;
7. verify login succeeds;
8. verify **no additional sign-in email** is sent;
9. verify account ownership/dashboard state is unchanged;
10. verify billing remains unavailable;
11. sign out;
12. verify the password-created session is revoked.

Do not test password recovery by sending another production email unless separately approved.

Suggested approval gate:

```text
APPROVE ONE PASSWORD AUTH OWNER CANARY
```

## Phase F — Account suspension/termination

After password auth is proven in production:

1. design the central account status model;
2. implement `active/suspended/terminated` enforcement in an isolated branch;
3. enforce status at login/session/API-key boundaries;
4. revoke/invalidate existing sessions on suspension/termination;
5. deny API authorization for suspended/terminated accounts;
6. add admin-only action paths with reason/audit metadata;
7. add tests for all enforcement boundaries;
8. review before merge/deployment.

This should precede broad public API customer acquisition.

## Phase G — API subscription billing readiness

Billing is a separate high-risk product phase.

Before enabling it:

1. finalize product/price definitions;
2. finalize customer-facing terms/refund/support/legal materials;
3. configure protected production Stripe credentials;
4. configure and verify signed webhooks;
5. verify idempotency and lifecycle ordering;
6. verify subscription entitlement creation/revocation;
7. verify plan changes/cancellations/payment failures;
8. verify API key issuance only for eligible plans;
9. verify customer billing management;
10. run controlled live canaries;
11. retain an emergency billing-disable switch;
12. obtain separate explicit production billing approval.

Do not combine billing enablement with password-auth rollout.

## Phase H — Paid priority queue rollout

Only after base subscriptions/entitlements are stable:

1. productionize the queue-backed worker;
2. prove all priority lanes;
3. prove DLQ/failure handling;
4. validate weighted concurrency/capacity;
5. integrate paid entitlement checks;
6. add customer-visible truthful status;
7. add monitoring/alarms;
8. run controlled production canaries;
9. separately approve customer exposure.

## Phase I — Documentation cleanup and stale PR closure

After the auth rollout stabilizes:

1. update README maturity statements;
2. update ROADMAP execution order;
3. update production API/auth docs;
4. clearly distinguish live customer accounts from disabled billing;
5. close superseded PR #127 if no unique work remains;
6. close superseded PR #136 if no unique work remains;
7. keep release evidence commit-bound.

## Phase J — Repository Audit v0

Once current launch/auth work is stable, the next major product expansion should begin in read-only mode.

Repository Audit v0 should provide:

- repository inventory;
- framework/package-manager detection;
- duplicate/backup/generated/large-file candidates;
- secret-pattern redaction and exposure warnings;
- deterministic findings;
- evidence, confidence, impact, and rollback notes;
- machine-readable JSON report;
- human-readable report.

Initial mode must remain **Analyze only**.

Do not begin write-enabled cleanup until read-only accuracy is established.

## Phase K — Repository Audit v1/v2

Later phases may add:

- import/reference graph;
- unused/dead-code candidates;
- dependency conflicts;
- route/config consistency;
- test/docs coverage mapping;
- approval-based cleanup branches;
- validation before PR creation;
- rollback instructions and audit ledger.

## Phase L — Server Audit v0

Server Audit should follow Repository Audit because its blast radius is higher.

Initial Server Audit must be strictly read-only with:

- constrained SSH account;
- command allowlist;
- no service restarts;
- no firewall/DNS mutation;
- no package installation/removal;
- no file deletion;
- no credential-value collection;
- redacted evidence;
- explicit severity and remediation proposals.

Pilot it on a controlled non-production host before any production server use.

## Phase M — Long-term language/platform work

Continue language improvements in parallel only when they do not bypass compiler correctness or production safety work.

Long-term areas include:

- stable spec;
- type system;
- formatter/linter maturity;
- VS Code tooling;
- packages/modules;
- provider abstraction;
- production integrations;
- hosted Rust validation/execution;
- managed workflow execution;
- observability/durability;
- enterprise governance.

---

# 13. Global stop conditions

Stop a production rollout if any of these occur:

- production API/customer-account health does not match the expected phase state;
- subscription billing unexpectedly becomes enabled;
- Stripe credentials appear in an auth-only deployment;
- the customer frontend points at another environment;
- password routes are missing after backend deployment;
- password login sends an unexpected sign-in email;
- stale sessions survive password change;
- stale pre-reset magic links survive password change;
- CSRF/session ownership changes unexpectedly;
- secrets, raw passwords, password verifiers, tokens, cookies, API-key secrets, peppers, or admin secrets appear in logs;
- production deployment ordering metadata is missing or ambiguous;
- rollback cannot restore the exact pre-deploy API/customer state;
- production operations baseline cannot be verified.

Fail closed rather than bypassing these controls.

---

# 14. Recommended near-term priority order

The practical next priorities are:

1. merge PR #139 after final-head CI/review is green and separately approved;
2. run the new protected password-auth production preflight;
3. separately approve and deploy password-auth backend with billing off;
4. publish/verify the password-auth frontend;
5. run one owner password-login canary and prove zero-email routine login;
6. build account suspension/termination enforcement;
7. clean up stale docs and superseded PRs;
8. choose the next commercialization track deliberately:
   - API subscription billing, or
   - Workflow Preflight production payment completion, or
   - Repository Audit v0;
9. keep paid priority disabled until subscriptions and queue operations are independently proven;
10. continue language/platform improvements without overstating maturity.

## Recommended commercialization sequence

For the shortest path to a safer self-service API product:

```text
password auth rollout
  -> suspension/termination controls
  -> documentation cleanup
  -> subscription billing readiness
  -> one controlled live billing canary
  -> API-key entitlement canary
  -> broader customer availability
  -> paid priority rollout later
```

Repository Audit can proceed as a separate read-only product track once the current production authentication work is stable.

---

# 15. Safety and authorization model

Continue using explicit phase gates.

A merge approval authorizes only the named merge.  
A preflight approval authorizes validation only.  
A deployment approval authorizes only the named deployment and stated feature flags.  
An email canary approval authorizes only the stated email count/purpose.  
Billing, Stripe/webhooks, charges, account suspension/termination, and destructive repository/server actions always require their own explicit scope.

This separation has already prevented several unsafe shortcuts and should remain part of SolveLang's operating model.
