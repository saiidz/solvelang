# SolveLang current contributor onboarding — 2026-09-13

This is a current-state repository onboarding guide, not a production authorization document. Live GitHub state and newer verified production evidence always override this snapshot.

## Exact repository baseline

At the start of this reconciliation, `main` is `67f2f38a1fb1f3b228953f9bce05b5fbc09a0a18`, the merge of #879.

The repository contains a working local Rust language/runtime and CLI, deterministic browser tooling, bounded read-only audit products, a separately deployed account/API/Admin foundation, repository-safe Self-Driving/PostHog preparation, and repository-side billing/recovery qualification. Those facts are not equivalent to a generally launched managed execution service.

## What a contributor may treat as working repository behavior

- Local SolveLang parsing, validation, checking, linting, formatting, and execution through the Rust CLI.
- The pure Rust evaluator core, deny-all WASM wrapper, conformance/resource limits, and the reviewed browser artifact path.
- Bounded read-only Repository Audit / Solve Graph and Server Audit surfaces.
- Repository-safe Self-Driving contracts through the PostHog auth/credential/kill-switch/lifecycle boundaries in #866–#870.
- The canonical Codex + Claude plugin bundle's installed-package MCP stdio roundtrip proof from #871.
- Repository billing proofs for webhook replay/delivery idempotency (#872), checkout ownership (#873), recovery ordering (#874), data-protection verification (#875), and fail-closed internal billing mutation gates (#879).
- Sanitized current-main rendering security evidence and the JSON-LD fix from #877.

## What is deliberately not established as live

Do not infer any of the following from repository code, tests, merged PRs, or green CI:

- a live PostHog project/key or provider request;
- the first real Self-Driving/PostHog canary (#833);
- a deployed external secret source or production kill-switch implementation;
- enabled subscription billing, live Stripe webhook/resource identity, a charge, or a refund;
- paid-priority queue/provider processing or customer-source execution;
- general managed hosted SolveLang workflow execution;
- marketplace/plugin publication or a published cross-platform CLI/runtime release;
- customer-account TOTP enrollment canaries or new production infrastructure mutations;
- Solve Runner/Solblend provisioning, registration, pricing, or rollout.

## Authority ladder

Treat repository preparation and live authority as separate layers:

1. **Repository behavior** — source, tests, schemas, docs, and deterministic local/offline evidence may be changed through reviewed PRs.
2. **External/live canary preparation** — contracts may describe credentials, kill switches, lifecycle operators, provider requests, billing state, or release publication, but must remain disabled/injected/non-secret until the exact live gate is approved.
3. **Production/provider mutation** — deployments, provider credentials, Stripe resources, charges/refunds, customer/Admin mutations, publication, and live canaries require separate owner/protected authorization and independent verification.

A merge never promotes work from one layer to the next automatically.

## Safe local validation

Use the narrowest applicable checks first, then the repository-required exact-head CI lanes.

### Rust runtime

```bash
cd solvec
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

Run `cargo audit` when dependency/security state is relevant.

### Website / Studio

```bash
cd site
npm ci
npm run lint
npm run test:studio
npm run build
```

Run contract-specific site suites when touching the corresponding surface.

### API/account services

```bash
cd services/api-access
npm ci --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

### MCP package

```bash
cd packages/mcp-server
npm ci
npm test
npm run test:packed
```

Do not substitute local success for the exact-head GitHub checks required by the affected PR.

## Pull-request merge discipline

Before merging a repository PR:

- verify the PR head SHA has not changed;
- require every applicable exact-head CI/security lane to be successful;
- inspect review submissions and inline review threads;
- fix findings rather than merely resolving the thread marker;
- confirm clean mergeability;
- merge with expected-head protection;
- never call a queued, stale, skipped, cancelled, missing, or unobserved check successful.

## Current launch blocker sequence

Repository-safe work should now proceed in this order unless live state exposes a more urgent blocker:

1. reconcile current README/ROADMAP/handoff/completion/status truth and Issue #113;
2. finish repository-side release regeneration/publication controls and supported-platform evidence without publishing;
3. record customer/legal decision checklists without inventing policy commitments;
4. continue concrete current-main security, monitoring, incident, rollback, and disable-path findings only where they can be verified safely;
5. produce a final project-completion report only after every repository-safe item is complete or explicitly parked behind an owner/external gate.

The live PostHog canary remains independently blocked by #833. Billing and publication remain independently owner-gated.

## Source-of-truth documents

Use these together rather than relying on an old handoff hash:

- `README.md` for public product maturity and local setup;
- `ROADMAP.md` for direction and state categories;
- `docs/project-completion-plan.md` for the canonical repository completion checklist;
- `docs/launch-readiness-checkpoint-2026-09-13.md` for the current launch evidence boundary;
- `docs/current-production-status-2026-08-20.md` for the last explicitly recorded production account/Admin/TOTP state;
- Issues #113 and #820 for production-readiness and completion tracking;
- Issue #833 for the owner-gated first live PostHog canary.

Solve Runners / Solblend remains separate from this SolveLang onboarding and completion lane.
