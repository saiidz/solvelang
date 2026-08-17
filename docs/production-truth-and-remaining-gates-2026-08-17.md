# SolveLang production truth and remaining gates — 2026-08-17

This document separates **last verified live production state**, **merged code**, **open build-only work**, and **owner-gated production actions**. A merged workflow is not evidence that the corresponding production mutation has run.

## Last verified live production snapshot

The production facts below are carried forward from the repository's 2026-08-15 handoff and were **not re-probed by this documentation-only refresh**:

- public site: `https://www.solve-lang.com`;
- Amplify application: `d3j3fgk4gcxxg2` (`solvelang`);
- production API stack: `solvelang-api-access-production` in `us-east-2`;
- API access and customer accounts enabled;
- username/password sign-in canary proven;
- suspension/reactivation enforcement canary proven;
- Admin CRM backend enabled;
- dedicated retained/termination-protected TOTP KMS foundation recorded as live;
- customer authenticator TOTP itself OFF;
- production subscription billing OFF;
- customer paid priority OFF;
- no real-charge authorization.

Any future live-state report should re-probe these facts read-only before claiming they remain current.

## Repository state verified 2026-08-17

Current `main` after this refresh base is `47b118d072b30cc3389bbcf03f0ff3faf314b191`.

### Merged

- **#168 — protected private Admin Gateway production rollout machinery** merged as `d36282e64390099fdae9c7554390f8ca6ee00d18`. It added the manual/protected deployment workflow, exact-stack CloudFormation IAM supplement, serialization participation, state-preserving rollback, termination protection, and read-only post-deploy verification. The merge itself did not apply IAM, deploy the gateway, configure DNS/ingress, or publish the Admin UI.
- **#159 — nested-import source provenance** merged as `47b118d072b30cc3389bbcf03f0ff3faf314b191` after refreshed exact-head hosted CI. Imported `.solve` parser/runtime diagnostics now preserve relative source provenance without a live-system change.

### Admin console publication preparation

- **#172 — deterministic private console publication artifact** is open and refreshed directly onto current `main` at head `ebd141e453547c11f0abb81fef2f5b217c85c7b5`.
- It builds the static Admin console deterministically, records file hashes/byte lengths, tightens browser CSP to same-origin connections, tests noindex/no-secret/same-origin contracts, uploads only a short-lived CI review artifact, and documents the private `/admin-gateway` ingress contract.
- It does **not** create DNS, choose a Zero-Trust provider, publish the UI, or deploy production infrastructure.

Private origin / identity-aware ingress remains intentionally owner/operator-specific rather than guessed in generic code.

### Customer-priority build stack

- **#160 — production-OFF source/executor foundation** refreshed onto current `main` at head `12ed4f8e8d2c6fb3d2ce4b0d860106b7199fb564`; exact-head hosted CI is being revalidated. Its production queue/customer/provider gates remain default OFF and no provider credential or billing path is introduced.
- **#164 — validation-only customer-priority production preflight** remains stacked on #160 and must be refreshed against #160's final reviewed head before merge consideration.
- **#165 — authenticated ZIP source upload and release-gated customer UI** remains stacked on #160 and must be refreshed against #160's final reviewed head. UI enablement remains OFF.
- **#166 — isolated same-host customer-priority API attachment** remains stacked on #165 and must be refreshed after #165's final head. Route attachment remains OFF.
- **#169 — dormant production queue foundation rollout preparation** remains stacked on #160. Its future workflow is intended to provision dormant queue resources only while queue/customer/provider gates remain OFF; live IAM/deployment stays separately gated.

### Cross-feature production-state hardening

- **#161 — preserve Admin CRM through auth rollback/redeploy paths** refreshed onto current `main` at head `0e5398ef2d2f5886e72cfebfe80bd3293f76257b`; exact-head hosted CI is being revalidated.
- This is production-sensitive rollback code but performs no production action by being present in a branch.

### This truth sync

- **#162** is documentation-only and is intentionally refreshed after #168 and #159 landed so it no longer presents those PRs as pending work.

## Admin Panel: exact remaining gates

The codebase can continue preparing artifacts and tests automatically, but actual Admin Panel availability still requires separately controlled live actions:

1. review/merge #172's build-only publication artifact preparation;
2. live-apply the already reviewed Admin Gateway deploy-role IAM supplement under explicit approval;
3. run the protected Admin Gateway production deployment and verify the unauthenticated `/session` 401/no-store/CORS contract plus termination protection;
4. provision a distinct private HTTPS Admin origin protected by an identity-aware/Zero-Trust access layer;
5. configure same-origin `/admin-gateway/*` ingress to the deployed gateway, stripping that prefix exactly once and never exposing the upstream API admin secret;
6. separately approve static Admin UI publication plus ingress/DNS changes;
7. run the read-only publication canary: access-layer denial before authentication, noindex UI, unauthenticated session 401, password login/session/CSRF, read-only customer lookup, sign-out, and billing still OFF.

Only after those gates succeed is `https://admin.solve-lang.com` expected to be a usable operator login surface.

## Customer priority: remaining build and launch gates

Safe build work may continue automatically while all launch gates remain OFF. The dependency order is:

1. finish exact-head validation of #160;
2. refresh/revalidate #164 and #165 on #160's final reviewed head;
3. refresh/revalidate #166 on #165's final reviewed head;
4. refresh/revalidate #169 on #160's final reviewed head;
5. keep queue/customer/provider flags OFF until separately approved production resource/IAM work exists;
6. choose and review the real provider/executor contract and credentials separately;
7. establish alarms, DLQ/stop thresholds, canaries, and rollback before any customer execution;
8. expose the customer UI only after backend execution has been proven.

Billing readiness and customer-priority technical readiness remain independent gates.

## Authenticator TOTP

TOTP application support is implemented but the customer-facing feature remains OFF in the last verified production snapshot. Before activation:

1. land/review the #161 state-preservation hardening;
2. run the validation-only production TOTP preflight from then-current `main`;
3. obtain explicit deployment authorization;
4. preserve API/customer/Admin-CRM state and billing=false during deployment;
5. perform an owner enrollment/login/backup-code/recovery canary only after deployment succeeds.

Authenticator rollout never authorizes billing.

## Billing

Production subscription billing remains a separate owner gate. Before any activation or real charge, finish webhook replay/idempotency proof, live Stripe configuration validation, subscription lifecycle canaries, customer-visible policy/disclosure checks, monitoring/rollback, and an explicitly approved limited real-charge canary. No admin, TOTP, priority, audit, or language-runtime approval implies billing approval.

## Review/merge dependency order

This is a dependency map, **not blanket production authorization**:

1. #172 — Admin static publication preparation (independent, build-only; production publication still separate);
2. #160 — priority production-OFF foundation;
3. #164 and #165 — independently stacked on #160 after refresh;
4. #166 — stacked on #165;
5. #169 — stacked on #160;
6. #161 — independent production-state hardening, required before future TOTP deployment;
7. #162 — truth sync after the reviewed heads above stabilize.

#159 is already merged and no longer belongs in the pending order.

## Invariants for future production work

Every production-mutating workflow must fail closed on missing/ambiguous state, preserve unrelated live feature flags, keep billing false unless billing has its own explicit approval, use the production deployment serializer where applicable, verify post-deploy state, provide state-preserving rollback, and never treat template defaults as authoritative live state.

Private admin origin/SSO/Zero-Trust provider choice, real priority executor/provider choice, production IAM application, deployment, DNS/ingress changes, billing activation, email side effects, customer/CRM mutations, and real charges remain explicit operator gates.