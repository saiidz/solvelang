# SolveLang legal and customer-launch decision checklist

This checklist records owner/counsel/business decisions that remain external to repository engineering. It does **not** supply legal advice, approve customer-facing commitments, enable billing, authorize production mutation, or create a release/publication approval.

## How to use this checklist

Every item below must be resolved by the appropriate business owner and, where appropriate, qualified counsel before the corresponding live launch claim is made. Repository code, tests, green CI, or merged pull requests do not substitute for these decisions.

For each decision, record the approved source document, approver, effective date, and any jurisdiction/product limitations outside this repository.

## Customer-facing terms and policies

- [ ] Terms of Service are approved for the actual SolveLang products and customer types being offered.
- [ ] Privacy Policy is approved and matches the actual production data flows, processors, telemetry, retention, deletion, and account-recovery behavior.
- [ ] Refund policy is approved and states when refunds are available, who can authorize them, and how exceptions are handled.
- [ ] Cancellation policy is approved and matches the implemented subscription cancellation/resume behavior.
- [ ] Renewal and recurring-billing disclosures are approved for the jurisdictions in which subscriptions will be sold.
- [ ] Data-retention and deletion commitments are approved and match production capabilities and backup/recovery constraints.

## Billing, receipts, and customer identity

- [ ] Legal business/seller identity shown to customers is approved.
- [ ] Stripe account/business identity, statement descriptor, and invoice branding are approved.
- [ ] Receipt and invoice email behavior is approved, including sender identity and support contact.
- [ ] Taxes/VAT/sales-tax handling is reviewed for the intended markets and customer types.
- [ ] Upgrade, downgrade, proration, cancellation, resume, failed-payment, dispute, chargeback, and refund customer expectations are approved.
- [ ] Any free-trial, promotional, credit, or discount terms are approved before being offered.

## Support and operational commitments

- [ ] Customer support contact/channel is approved and staffed for the intended launch scope.
- [ ] Support hours and any response-time commitments are approved; no SLA is implied unless separately approved.
- [ ] Incident/customer-notification criteria are approved for security, billing, availability, and data-integrity incidents.
- [ ] Account suspension/termination policy and appeal/escalation path are approved.
- [ ] Abuse/acceptable-use rules are approved for the features actually exposed to customers.

## AI, provider, and Self-Driving disclosures

- [ ] Customer-facing description of AI/provider use is approved and matches actual enabled providers and data flows.
- [ ] Any repository/code/content sent to third-party providers is covered by approved customer terms and privacy disclosures before live activation.
- [ ] Self-Driving authority is described accurately: repository preparation does not imply automatic PR creation, auto-merge, production mutation, or live PostHog access.
- [ ] The first live PostHog canary remains separately gated by Issue #833 and requires current project/key-scope verification, concrete reviewed credential/lifecycle backends, and fresh owner authorization.

## Release and distribution decisions

- [ ] Public version selected by the owner.
- [ ] Supported CLI platforms explicitly selected; unsupported macOS ARM64 or Windows x64 artifacts are not claimed without exact-platform evidence.
- [ ] Annotated release tag creation approved.
- [ ] GitHub Release/public asset publication approved.
- [ ] Codex/Claude marketplace or external distribution publication approved separately from repository-level integration proof.

## Explicitly separate product boundary

- [ ] Solve Runners/Solblend launch, pricing, runner registration, platform support, and commercial terms are handled as a separate product decision and are not inherited from SolveLang repository completion.

## Evidence record template

For each checked item, record outside this checklist or in an approved follow-up document:

- decision;
- approver/owner;
- counsel review where applicable;
- approved source/version;
- effective date;
- jurisdictions/customer scope;
- production configuration or release artifact that implements the approved decision;
- rollback/change-control owner.

Until a decision is checked and supported by approved evidence, treat the corresponding live customer, billing, provider, publication, or legal claim as **not authorized**.
