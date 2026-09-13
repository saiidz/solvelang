# Public-site repair evidence — 2026-09-13

Scope: PR #894 navigation, capability-copy reconciliation, status history and regression tests. This record does not authorize billing, provider activation, cloud mutations, or a release publication. Solve Runners/Solblend and UpcomingSounds are outside this change.

## Sources and limits

- Owner-provided AWS Amplify console evidence reported deployments 732 (support preview) and 733 (workflow audit) successful on September 13. Their displayed start times are not health checks or a continuing uptime feed.
- Owner-provided production API-access CloudFormation/Lambda output on September 13 showed API/customer-account infrastructure enabled and API subscription billing disabled; the inspected API Stripe key, webhook secret and three price IDs were unpopulated.
- This evidence applies to the inspected API subscription service, not an independent audit of the separate entitlements checkout service. No charge/refund, provider request, or new authenticated AWS inspection is established by these site changes.
- Main a59b7b15 contains local rule-based audit/support components and the pinned browser safe-core runtime. Preview results are not external actions.
- The August 6 GitHub incident record is preserved verbatim as historical evidence. Its closure timestamp was not independently established. Archiving it does not fabricate a resolution or uptime history.

## Repair acceptance

One shared primary header is mounted by the English root layout without route exclusions. Legacy public-site bars are removed from the homepage, About, API Pricing, Check, Repository Audit and Browser Preview; workspace controls remain local secondary controls. Account points to the implemented `/account/api-keys/` route. Native disclosure navigation remains usable without JavaScript, with Escape/outside-click/client-navigation closure when hydrated. A skip target, active route normalization and narrow-screen layout are covered.

Homepage, About, API Pricing, status configuration notes and structured metadata use `site/app/product-capabilities.ts`. Public labels distinguish local tools, previews, deployed-but-gated infrastructure, experimental providers and disabled billing. A successful build does not change these feature gates.

Status has no invented operational observations. Only timestamped health evidence can produce an operational badge, expires within fifteen minutes, and cannot hide unknown components. Static HTML is conservatively unverified; client time reevaluates expiry. Historical incident messages remain available separately from current reports.

## Validation commands

- `npm run test:public`: compiled TypeScript route/status/capability tests.
- `npm run build`: existing WASM/i18n prebuild checks plus the new public tests, full Next build and exported-navigation checks.
- `node qa/public-browser-smoke.mjs`: dependency-free Chromium checks against `out/` at desktop and narrow widths. External requests are blocked. This is not a production canary.

Validation results belong in the PR/CI run for the exact head; these commands are acceptance criteria, not a claim that every future commit passes.

## Remaining independent work

Audit/support-preview correctness and real connected support automation remain separate from this PR. Live alert delivery and isolated recovery exercises, per-service billing verification, IAM/SES scope review, provider canaries, effective branch protection and final release decisions still require their own evidence. Do not close the entire project from a site build.
