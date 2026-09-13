# SolveLang final current-main security review — 2026-09-13

This review is repository evidence only. It does not certify production infrastructure, live credentials, Stripe configuration, deployed controls, customer data handling, public release state, or any external provider. No production/provider/billing mutation is authorized by this document.

## Reviewed checkpoint

- exact starting `main`: `75ed221c2187e4e7320a052c7cc1736724a73d2e` (merge of #886);
- no open pull requests at the start of this review;
- #866 remains merged at exact reviewed head `37343b53901256096d804bd01851577e944c1f66`, with its three blocking review threads resolved and exact-head CI, Rust/RustSec, and WASM artifact-security successful;
- #833 remains open as the owner/credential gate for any real PostHog canary.

The purpose of this pass is to re-check the security-relevant repository delta that landed after the earlier JSON-LD review rather than silently treating `docs/security-review-2026-09-13.md` as a whole-product certification.

## Re-reviewed security-relevant delta

### Internal subscription billing disable path — #879

The admin/internal subscription checkout and provisioning routes now check `subscriptionBillingEnabled` before invoking either checkout creation or subscription provisioning. The regression test asserts that both side-effect callbacks remain uncalled while the gate is false.

The environment parser keeps the Stripe secret key, webhook secret, and price IDs undefined unless `API_SUBSCRIPTION_BILLING_ENABLED === "true"`. Repository production-preflight/deployment contracts also continue to carry billing-disabled expectations. This is repository fail-closed evidence only; it does not prove the live production flag value or authorize a billing activation.

No bypass of the two internal subscription mutation routes was identified in the reviewed current-main route search.

### Tagged release regeneration boundary — #881

The tagged regeneration workflow remains manual (`workflow_dispatch`), uses `contents: read`, disables persisted checkout credentials, validates a semver-like tag name, requires an existing annotated tag, peels it to one commit, checks out that commit detached, exact-binds tag/Cargo/source identity, and records `publishable: false` evidence. The implemented target remains Linux x86_64 only.

The selected tagged source is intentionally built and tested on an ephemeral GitHub-hosted runner. That is release-evidence execution, not production execution. The workflow has no release-write, package-write, deployment, billing, provider, or production permission in its declared GitHub token scope. Tag selection therefore remains a trusted owner/operator release decision; this review does not convert arbitrary historical tags into approved release sources.

No new material workflow-injection or publication-authority finding was validated in the reviewed #881 boundary.

### Packaged CLI version/provenance binding — #882

The release-candidate verifier now derives the expected version from provenance and requires the extracted packaged binary to emit exactly `solvec <version>` on stdout with no stderr. A hostile regression proves that an artifact whose embedded CLI version reports `9.9.9` while provenance claims `0.1.0` is rejected.

This strengthens artifact identity but does not make the candidate publishable and does not establish macOS ARM64 or Windows x64 release support.

### Browser rendering boundary — #877 preservation check

The earlier validated JSON-LD script-termination issue remains fixed by the dedicated serializer and enforced hostile regression. No later reviewed code delta reintroduced raw `JSON.stringify(data)` as the JSON-LD script payload boundary.

## Result

No additional material source-level security finding was validated in this focused current-main delta review.

That statement is deliberately narrow. It means the reviewed post-#877 repository changes above did not produce a new confirmed issue requiring a corrective PR before the repository-completion loop can continue. It is not a claim that every application path, dependency, cloud configuration, runtime secret, customer workflow, or production control has been penetration-tested or live-verified.

## Remaining gates and limitations

- #833 remains open. A real PostHog canary still requires current project/key-scope verification, reviewed concrete external secret/lifecycle implementations, and fresh owner authorization.
- Subscription billing, paid priority, and provider execution remain off/unproven unless separately authorized and live-verified. Repository tests are not evidence of a Stripe call, charge/refund, or production activation.
- Public tag/release creation and asset/package publication remain owner-controlled. Existing repository regeneration evidence is non-publishable and Linux x86_64 only.
- Production restore capability is not proven by the repository-only data-protection verifier; a real restore/reconciliation action remains separately controlled.
- Solve Runners/Solblend remain separate and are not granted authority by Self-Driving, release, billing, or security-review work.

The next repository-safe completion work is truth/status reconciliation, remaining launch-decision checklists, and a completion report only after all repository-safe items are actually complete or explicitly blocked by an owner/external decision.
