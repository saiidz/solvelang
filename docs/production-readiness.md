# SolveLang production readiness

Status: **customer-facing API/account infrastructure is live; API subscription billing is enabled for controlled rollout; paid-priority/provider processing, support-automation activation, the first real-payment canary evidence, and the first live PostHog canary remain disabled or not established as live.**

This document is the current launch-control summary. Historical preparation and rollout runbooks remain useful procedures, but their original `prepared`, `not deployed`, or `disabled` status text is not authoritative evidence of current production state. Use Issue #113 and the dated production-status records for the evidence trail, and require fresh proof before any protected live action.

## Verified current production boundary — 2026-09-17

The following facts have current evidence recorded in Issue #113:

- API access is enabled.
- Customer username/email + password accounts are enabled.
- The private Admin Gateway and static Admin UI are live behind Cloudflare Access.
- Authenticator-app TOTP infrastructure is enabled; specific customer-account enrollment remains separate account state and is not implied.
- Production API subscription billing, checkout, Stripe price validation, webhook signature enforcement, and billing-failure monitoring were verified enabled for controlled rollout.
- The first real-payment canary evidence remains pending, so broader public payment availability is not yet claimed.
- Production API/authorizer alarms and priority-DLQ alarms are enabled and route to a confirmed SNS subscription; the checked alarms were `OK` when verified.
- Production API Lambda log retention is 90 days, authorizer log retention is 90 days, and the production Admin gateway log retention is 30 days.
- PITR is enabled for the verified API accounts, API keys, customer-auth, and subscription-events DynamoDB tables. A real restore drill has not been performed and remains separately approval-gated.
- The connected support-automation repository core, default-off deployment foundation, native Mailcow-compatible IMAP/SMTP path, and default-off support monitoring/recovery controls are merged through #897, #903, #906, and #908. #906 retains Gmail as an optional provider and repository-qualifies tenant/mailbox/secret-bound verified-TLS IMAP/SMTP, safe pre-activation cutover/cursor recovery, durable action outcomes, and account setup/status/history controls with synthetic protocol/integration/concurrency/security tests. #908 repository-qualifies worker/schedule failure alarms, unknown-outcome and bounded message-age metrics/alarms, an activation-time alarm-destination requirement, and a state-preserving disable/recovery procedure. These are repository qualifications only: the support stack/monitoring have not been deployed or activated, production provider credentials have not been provisioned or accessed, and no live inbox/task/reply or stop/recovery canary has been performed.
- The dormant paid-priority path now has repository-qualified worker/dispatcher error alarms, dispatcher-failure-queue monitoring, per-lane visible-backlog and oldest-message-age alarms, and an activation-time alarm-destination interlock from #910. Paid priority/provider execution remains OFF; these alarms are not claimed deployed or live.
- The subscription-billing path has repository-qualified sanitized webhook-failure logging plus a scoped CloudWatch Logs metric filter and repeated-failure alarm contract from #911, followed by the protected billing rollout train through #932-#937. The checkout recovery fix in #937 prevents failed Stripe session creation from stranding an account in a pending-checkout state.
- The active `Protect main` ruleset was re-read on 2026-09-20: it requires pull requests, resolved review conversations, and four strict current-head status checks (Rust runtime, Static site, SolveLang Rust security and tests, WASM artifact security). Required human approval count is zero; there are no bypass actors.

None of the facts above authorize paid priority, provider execution, a support inbox canary, a PostHog canary, a production restore drill, broader public billing claims beyond controlled rollout, or another production mutation.

## Studio maintenance — 2026-09-20

PRs #939–#942 deployed the Studio workspace backend without changing existing
account, TOTP, billing, table or IAM settings. Plan run 35530924473 and execution
run 35531150309 passed at main `632b6ff82f2f54babe46e4e11e672675e4ca838e`.
The workflow verified unchanged parameters/health and a 401 response for an
unauthenticated Studio GET. The frontend account-saving flag remains off until
two-account/cross-device acceptance. This deployment is not payment or provider
activation evidence.

## Environment isolation

Use the dedicated GitHub Environment `api-access-production`. It must not reuse values from `api-access-test`.

Required production-only values include:

- `AWS_ROLE_ARN`
- `AWS_DEPLOY_ROLE_ARN` for separately approved deployments
- `AWS_REGION`
- `API_ACCESS_STACK_NAME` containing `prod` or `production`, never `test`
- `SITE_ORIGIN`
- `CUSTOMER_AUTH_EMAIL_SENDER`
- `CUSTOMER_AUTH_EMAIL_REPLY_TO` when used
- `API_KEY_PEPPER`
- `API_ACCESS_ADMIN_SECRET`
- `CUSTOMER_AUTH_PEPPER`
- `STRIPE_SECRET_KEY` for the approved billing rollout only
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` for the approved billing rollout only
- three unique live recurring Stripe Price IDs for Developer, Pro, and Business for the approved billing rollout only

The production peppers and admin secret must remain distinct and must not equal their test-environment counterparts.

## Current hard safety boundary

API access and customer accounts are already enabled in production. Subscription billing is enabled for controlled rollout, with first real-payment canary evidence still pending. Do not treat the live account stack or billing checkout surface as authorization to expose paid priority, provider execution, or broader public payment claims without the remaining evidence.

The customer-account deployment workflow remains manual, main-only, protected by `api-access-production`, and explicitly preserves billing-off behavior. Re-running it is not a routine maintenance step; any new production mutation still requires fresh scope-specific approval.

Support automation is also separate from the live customer-account stack. #903 prepares a default-off production foundation, #906 adds the qualified selectable Gmail/native-Mailcow transport, safe cutover/recovery path, and customer controls needed by the owner's existing `hello@solve-lang.com` mailbox without changing mailbox/DNS/relay configuration, and #908 adds repository-qualified monitoring and state-preserving disable/recovery controls. Applying the IAM supplement, deploying the support stack/monitoring, provisioning exact-scope mailbox/Linear credentials, enabling polling/actions, or running a real provider or stop/recovery canary remain separate owner-authorized gates under #896. The shared mail host is not authorization to operate on other projects, server settings, or mailboxes.

The first live PostHog request remains separately gated by #833 and must not be inferred from repository integrations or ChatGPT connectors.

## Billing acceptance before broader launch

Before broader public billing availability is claimed, verify all of the following in live configuration and record the limited payment canary evidence:

- Developer is $49/month.
- Pro is $199/month.
- Business is $699/month.
- All three prices are active, USD, monthly, recurring, and `livemode=true`.
- Production webhook uses an independent signing secret.
- Customer-visible business identity, invoice branding, receipt email behavior, statement descriptor, support contact, and cancellation disclosures are reviewed.
- Checkout ownership and plan selection remain authenticated and account-bound.
- Upgrade payment remains payment-authoritative.
- Failed payment does not grant an unpaid higher-tier entitlement.
- Downgrade/cancellation/resume/recovery ordering is verified against the production provider configuration.
- Webhook replay/idempotency and confirmation-delivery behavior remain green under current repository tests.
- Refund policy is approved before launch.

Repository tests for billing replay and lifecycle behavior are evidence for code behavior only. They do not replace live Stripe configuration evidence or the explicitly scoped payment canary record.

## Reliability and recovery

### Verified repository/live evidence

- CloudWatch API Lambda and authorizer error/throttle monitoring is present.
- Priority-DLQ alarms and the production notification path were verified, with alarm actions enabled.
- Core account/customer-auth/subscription-event DynamoDB PITR is enabled.
- Production API, authorizer, and Admin gateway log-retention settings were verified as described above.
- Site/API deployment paths contain rollback and disable controls documented in the repository.
- #908 adds repository-qualified support-worker Lambda/schedule failure alarms, unknown-outcome and bounded message-age metric alarms, an activation prerequisite for an operations alarm destination, and a bounded state-preserving disable/recovery procedure. These controls remain default-off/unproven in production until the support foundation is separately authorized and deployed.
- #910 adds repository-qualified paid-priority worker/dispatcher failure, dispatcher-failure-queue, visible-backlog, and oldest-message-age alarms plus an activation-time operations-destination interlock. Queue/customer/provider gates remain default-OFF, and deployment/live alarm state is not established by the merge.
- #911 adds repository-qualified sanitized subscription-webhook failure monitoring: a bounded failure marker, scoped CloudWatch Logs metric filter, and repeated-failure alarm contract routed to the configured operations destination. The protected billing rollout train through #932-#937 records controlled-rollout enablement and checkout recovery behavior; the first real-payment canary remains the next evidence gap.

### Still required before broader launch

- Before broader billing launch, retain fresh evidence for the deployed #911 metric filter, alarm destination, alarm actions/state and webhook identity, and complete the scoped real-payment canary.
- Before paid priority/provider processing is enabled, separately authorize the priority rollout and verify the deployed #910 worker/dispatcher/failure-queue/backlog/age alarms and alarm destination against the live stack.
- Before support-provider activation, separately authorize deployment of the already-qualified #908 support monitoring controls and verify the configured alarm destination/alarms against the deployed support stack. Any live provider or stop/recovery exercise remains separately owner-approved.
- Perform any restore or rollback exercise only under its separate owner-approved operational scope; current PITR evidence is not a restore-drill result.
- Re-review log content and retention so credentials, tokens, payment secrets, customer source, and raw support-message bodies cannot leak into logs or exported evidence.
- Keep feature-disable switches and incident contacts current.

## Security review

Immediately before each broader production launch step:

- run the applicable API tests, site CI/browser acceptance, Rust tests, clippy, formatting, release build, and dependency/security audit;
- require exact-current-head evidence rather than stale successful checks;
- review IAM permissions for least privilege;
- strengthen `main` repository rules so required current-head status checks and review policy are enforced rather than relying only on manual merge discipline;
- verify CORS is restricted to the approved production SolveLang origin;
- review session lifetime, sign-in/recovery expiration, and abuse throttles;
- verify CSRF protections on browser mutations;
- verify API-key scope and quota enforcement;
- verify webhook signature verification and duplicate-event handling before billing is enabled;
- verify support-worker secret access remains tagged, tenant-scoped, and limited to the approved SolveLang support namespace/endpoints before support activation;
- verify no plaintext API keys, session tokens, recovery/sign-in tokens, peppers, Stripe secrets, provider credentials, or full payment credentials are logged;
- document rotation for every production secret or credential reference used by the activated feature.

## Customer/legal launch blockers

Repository review has not established approved production Terms of Service, Privacy Policy, or refund/cancellation policy content that can be treated as owner/legal sign-off for real paying customers. Production subscription launch remains blocked until the business owner approves the customer-facing materials.

At minimum, the billing launch review must confirm:

- Terms of Service
- Privacy Policy
- refund policy
- cancellation and renewal disclosure
- billing frequency and plan-price disclosure
- support/contact method
- incident/payment-failure communication path

Do not generate or publish legal policy text solely from this checklist without appropriate owner/legal review.

## Go/no-go rule

Production subscription billing is **NO-GO** if any item below is false:

1. Production GitHub Environment is isolated and protected.
2. Required current-head merge checks/review policy are actually enforced or the exact protected release procedure provides an equivalent reviewed gate for that action.
3. Live Stripe resources are validated and independent from test.
4. Monitoring and recovery controls needed by the activated billing paths are operational.
5. Security review is green.
6. Customer/legal policies are approved and published.
7. Production launch runbook has been reviewed/dry-run for the exact release scope.
8. The owner explicitly approves enabling the production billing deployment path.
9. The owner explicitly approves the limited billing canary.

Customer-account access is already live and must not be described as a future first enablement. Any further account-stack mutation still requires its protected workflow and fresh approval. Billing, paid priority, support-provider activation, PostHog activation, restore drills, and other production-sensitive operations remain separately gated.
