# SolveLang full-project completion evidence

Repository source status was re-audited on 2026-09-22 at main
`59ab9ff271850454a2029495c2faf34cb93a10c7` after #945. Production/runtime and
native-platform observations below were checked on 2026-09-20 through main
`632b6ff82f2f54babe46e4e11e672675e4ca838e` (#938–#942); each external
observation is separately identified and keeps its own collection date.
The goal includes the existing roadmap and requested Studio account persistence.
It excludes the separately deferred Solve Runners/Solblend product and does not
invent a 1.0 language/platform promise. Completion requires evidence, not a
percentage estimate or a count of merged PRs.

| Requirement | Evidence/status | Remaining acceptance |
| --- | --- | --- |
| Remove beta positioning | Confirmed: #938 merged; six public resources returned 200 with zero beta labels | None for this copy change |
| GitHub About description | Confirmed saved in the authenticated repository UI | None |
| Main governance | Confirmed: ruleset 18206723, four strict checks, PR required, threads resolved, no bypass | Human approval count is zero by configured policy |
| MCP v0.3.0 publication | Confirmed npm registry and published GitHub Release | Does not prove marketplace installation |
| Studio account saving | Merged #939 at `8ef4829228e89c1c04ab3f2e0565dc6357b5fce7`; 515 API tests, full Studio suite, five CI workflows passed | Backend deployed in run 35531150309 with configuration preserved; all six authenticated account-isolation, conflict, switching, offline, export and removal checks remain required before frontend enablement |
| Safe API maintenance deployment | Merged #940 adds bounded changes, parameter preservation and rollback; 521 API tests pass with #942 | Plan 35530924473 and deployment 35531150309 passed; all parameters/health flags preserved; unauthenticated Studio GET returns 401 |
| Admin Gateway rollout guard | PR [#945](https://github.com/saiidz/solvelang/pull/945) exact head `c709b3a8325404d2f88d83138a1b331c4e8f04fd` passed API Access CI and all four required contexts; merged as `59ab9ff271850454a2029495c2faf34cb93a10c7`. The four required main checks and API Access CI also passed on that merge commit. The manual workflow now preserves the captured billing flag; it was not dispatched. | Future manual dispatch still requires a separate production approval; this repository change is not deployment evidence |
| Solve Context independent corpus | Chalk/node-fetch/Preact and heldout protocol exist after #922–#924 | Blinded outcomes and actual Claude/Codex provider-token/latency/task-quality matrix |
| Managed Codex marketplace install | Repository packaging/import contract exists | Actual managed-workspace installation and tool invocation evidence |
| Public Plugin Directory | Unverified | Submission/review/listing evidence |
| Production API health | Confirmed public `/health`: API, customer accounts, TOTP and subscription billing enabled | Health flags do not establish payment outcomes |
| API subscription payment canary | Unverified; live Stripe search found no subscriptions with Developer/Pro/Business plan metadata | Explicitly scoped successful payment, webhook/account entitlement, cancellation/refund/recovery evidence |
| Connected support #896 | Repository implementation and monitoring exist | Deployment, scoped credentials, bounded new-message task/reply and stop/recovery proof |
| PostHog #833 | Repository transport/lifecycle contracts exist | Concrete credential/lifecycle backend, project scope and one bounded live canary |
| Paid priority/provider execution | Repository qualification only | Verified deployment, provider credentials, alarms and recovery acceptance |
| Native macOS ARM64 / Windows x64 qualification | Merged #941; both native jobs passed at `ed0dbcc82467fb690d2d8dd4420a964001b44846`, run 35530427540 | A new public native release/tag, signing and notarization are not implied |
| Final security and production smoke | Focused changed-boundary review completed; #942 main CI and deployment passed; #943 exact PR head `63b45066fe1e837a158333cb0dfee17d0c6ae31b` passed all five workflows (MCP CI, Rust, Release Candidate CI, CI, WASM artifact security) | Remaining authenticated Studio, payment and provider acceptance |

## Directly inspected sources

- [PR #938](https://github.com/saiidz/solvelang/pull/938)
- [PR #943](https://github.com/saiidz/solvelang/pull/943), exact PR-head workflows [MCP CI](https://github.com/saiidz/solvelang/actions/runs/35531758510), [Rust](https://github.com/saiidz/solvelang/actions/runs/35531758506), [Release Candidate CI](https://github.com/saiidz/solvelang/actions/runs/35531758515), [CI](https://github.com/saiidz/solvelang/actions/runs/35531758509), and [WASM artifact security](https://github.com/saiidz/solvelang/actions/runs/35531758514)
- [PR #939](https://github.com/saiidz/solvelang/pull/939)
- [PR #945](https://github.com/saiidz/solvelang/pull/945), exact head `c709b3a8325404d2f88d83138a1b331c4e8f04fd`; main checks on merge `59ab9ff271850454a2029495c2faf34cb93a10c7`: [API Access CI](https://github.com/saiidz/solvelang/actions/runs/35809781929), [CI](https://github.com/saiidz/solvelang/actions/runs/35809781905), [Rust](https://github.com/saiidz/solvelang/actions/runs/35809781907), and [WASM artifact security](https://github.com/saiidz/solvelang/actions/runs/35809781899).
- [Validated production plan](https://github.com/saiidz/solvelang/actions/runs/35530924473) and [successful deployment](https://github.com/saiidz/solvelang/actions/runs/35531150309), both at main `632b6ff82f2f54babe46e4e11e672675e4ca838e`.
- [Native qualification #941](https://github.com/saiidz/solvelang/pull/941) and [both-platform run](https://github.com/saiidz/solvelang/actions/runs/35530427540).
- Native workflow artifact IDs: Windows `10611202508`; macOS ARM64 `10610698792`. These expire after 14 days and are qualification evidence, not public releases.
- [Main ruleset](https://github.com/saiidz/solvelang/rules/18206723)
- [MCP v0.3.0 release](https://github.com/saiidz/solvelang/releases/tag/v0.3.0)
- npm read: `npm view @solvelang/mcp-server@0.3.0 version dist.integrity dist.tarball --json`
- npm integrity: `sha512-aOH/Sg6OF17sePGlnoJ6hfFdEY4tL1Wj/ZW8A3ZmpZg9doFJpCC4IUTmhWnTZZY8iToc5y52+n9+Cu/Z68xUlA==`
- Public API health: `https://3l3y008e94.execute-api.us-east-2.amazonaws.com/health`.
- Live website checks: `/`, `/about/`, `/landing/`, `/run/`, `/check/`, `/llms.txt`.
- Live Stripe read-only search in the configured SolveLang merchant account:
  `metadata['plan']:'developer' OR metadata['plan']:'pro' OR metadata['plan']:'business'`.
  Empty results with no further page are limited search evidence, not a claim that
  the merchant has no payments or that the checkout is defective.

No charges, refunds, inbox messages, customer data changes, provider activation,
or secret provisioning were performed for this evidence record.

See [the changed-boundary verification](completion-security-review-2026-09-20.md)
for failure classifications and the limits of repository evidence.
