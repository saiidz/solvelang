# SolveLang current repository status — 2026-09-13

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
See [the current completion checklist](project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.


This document is the current repository-truth checkpoint for `saiidz/solvelang` after the late-stage launch-readiness/security/release-control train. It supersedes stale "current" statements in `ROADMAP.md` and `docs/active-buildout-handoff.md` where those files still describe the 2026-09-04 observe-only/browser-preview state. Historical detail in those documents remains useful, but live GitHub state and this checkpoint win for current repository status.

## Current reviewed baseline

- `main` at this checkpoint is `95edf247007b11d46b93701efd0afb848c573078`, the verified merge of PR #887.
- PR #866, the PostHog canary isolated runtime gate, is merged. Its blocking review findings were fixed before merge and its exact-head CI/Rust/RustSec/WASM qualification was green.
- The repository-safe Self-Driving train is no longer accurately described as observe-only through #799. Subsequent merged work added the governed suggestion/tested-PR boundaries, PostHog runtime credential/kill-switch/lifecycle isolation, and repository-side canary preparation while preserving explicit live-production gates.
- PostHog live execution remains **not authorized**. Issue #833 remains the owner/credential gate for the first real canary and still requires current project/key-scope verification, reviewed concrete external secret/lifecycle implementations, and fresh owner authorization.
- Codex and Claude repository-level MCP/package integration proof is merged through #871. External marketplace/publication/install actions remain separately gated and are not established by repository proof alone.
- Billing readiness now includes replay/outbox/delivery-ledger proof, checkout ownership binding, payment-recovery ordering, production data-recovery verification, and fail-closed internal subscription kill-switch hardening through #879. Production billing remains OFF unless separately and explicitly enabled through a protected live action.
- Release-control hardening through #885 includes annotated-tag regeneration gates, packaged CLI version/provenance binding, and current release-truth reconciliation. Repository evidence remains non-publishable until a separately authorized release/tag publication action occurs.
- #887 records the fresh current-main focused security review after the final billing/release-control changes. It found no additional validated material source-level finding in that focused delta review; it is not a whole-product or production security certification.
- Solve Runners/Solblend remains a separate product/security/commercial boundary. No Solve Runner authority is inherited by Self-Driving or release work.

## Browser/WASM truth

The old statement that `/run/` "remains TypeScript" is stale. The current reviewed browser path uses the pinned, hash-verified audited WASM handoff under the repository's bounded browser/runtime contract. The former TypeScript preview is not an execution fallback.

The browser/WASM implementation is a separately qualified bounded preview/runtime surface. It does not establish general hosted execution, production deployment authority, provider credentials, or managed customer execution.

## Self-Driving truth

The old 2026-09-04 summary that Self-Driving is only an observe-only train through #799 is stale.

Current repository evidence includes the later governed write-side boundaries and PostHog isolation/lifecycle work. Those merges do **not** authorize a live provider request, production mutation, automatic merge, billing activation, or credential use. The first live PostHog canary remains blocked by #833 until the owner-only conditions are satisfied.

## Billing and production truth

Repository billing work is significantly beyond the older readiness-only checkpoint, but production authority remains separate:

- repository checkout identity binding is proven;
- subscription event recovery/replay ordering is covered;
- entitlement/outbox/delivery-ledger replay behavior is covered;
- production data-recovery prerequisites are verified read-only;
- internal subscription mutation routes fail closed when billing is disabled;
- this 2026-09-13 checkpoint still treated production billing as disabled unless separately enabled; later controlled-rollout billing commits through #932-#937 supersede that fact where current production billing status is discussed;
- no repository merge is standing authorization for a Stripe charge, refund, webhook mutation, account mutation, or deployment.

## Release truth

Repository release controls now prove a Linux x86_64 candidate/tag/provenance path more strongly than the older handoff describes. They do not establish macOS ARM64 or Windows x64 public release support, nor do they publish anything by themselves.

Final release/publication still requires an explicit protected action and exact live-state verification at the time of release.

## Current safe completion sequence

1. Keep exact-head CI/Rust/RustSec/WASM/security qualification green for any remaining repository changes.
2. Reconcile stale top-level roadmap/handoff text against this checkpoint when editing those large historical documents; do not treat their older 2026-09-04 "current" paragraphs as authoritative.
3. Maintain the #833 owner/credential gate for the first real PostHog canary; perform no live request until its explicit conditions are satisfied.
4. Keep production billing OFF unless a separately approved live rollout verifies Stripe/webhook/entitlement behavior under protected controls.
5. Preserve Codex/Claude repository integration proof and treat external marketplace/publication as separate live actions.
6. Keep Solve Runners/Solblend separate from SolveLang completion.
7. Before any public release, re-verify current `main`, release/tag/provenance evidence, platform claims, security findings, open issues/PRs, and production/legal/business gates.

## Explicit non-authority

This checkpoint performs or authorizes none of the following: deployment, live credential resolution, PostHog provider request, Stripe action, charge/refund, production account mutation, public tag/release publication, customer notification, legal acceptance, marketplace publication, or Solve Runner/Solblend action.
