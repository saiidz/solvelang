# SolveLang checkpoint: 2026-08-22

This checkpoint supplements `docs/active-buildout-handoff.md`. Live GitHub state and newer verified production evidence remain authoritative.

## Repository checkpoint

Current reviewed `main` after the safe Server Audit merge train is:

- `195d3439d4b599abf722d8e9fda89ccdf110e222` — merge of #721.

The safe open pull-request queue was **zero** immediately after #721 merged.

Recent merged train:

- #716 — bounded scheduled-job finding materialization and bounded contradictory-evidence retention.
- #717 — bounded process-state/process finding materialization with exact aggregate cardinality.
- #719 — bounded public-file finding/evidence materialization with stable-ID regressions.
- #720 — bounded listener-consistency finding/evidence materialization with stable-ID regressions.
- #721 — bounded backup-coverage finding materialization with exact historical deterministic-prefix regression coverage.

#718 was closed and superseded by #719; do not recreate it.

## Mac validation policy changed

#716 moved `.github/workflows/trusted-mac-ci.yml` away from the physical self-hosted Mac pool.

Current Trusted Mac behavior on `main`:

- push-only for owner-controlled `agent/mac-*` branches;
- `runs-on: macos-14` (standard GitHub-hosted ARM64 macOS runner);
- concurrency group `trusted-mac-hosted-${{ github.ref }}`;
- `cancel-in-progress: false`;
- read-only repository permissions;
- the existing status-mirror contract still requires exact-head `trusted-mac-ci` success when a branch declares Trusted Mac validation.

Exact #716 hosted-Mac verification:

- Trusted Mac CI run `32554248617` completed successfully on exact head `38b01e020ef2bff169a81b288d06a04774c53e1b`;
- mirrored commit status `trusted-mac-ci` was `success` before #716 merged.

Do **not** re-route, re-register, relabel, or consume UpcomingSounds/UCS self-hosted Mac runners for SolveLang merely to satisfy Trusted Mac CI. SolveLang now has a standard GitHub-hosted Mac path for that workflow.

## Exact integration validation

- #716 exact head `38b01e020ef2bff169a81b288d06a04774c53e1b`: Hosted CI green, Rust/RustSec green, Trusted Mac CI green, review thread resolved, mergeable; merged as `4ee0d3d9964d7841ff3808b2e78dd946b525d4fb`.
- #717 exact reconciled head `f184246685c4548f39b5e3e848d9cee5c18f682a`: Hosted CI #2039 green, Rust/RustSec #4414 green, zero review threads; merged as `43622b8bbb731cf8d26da89207d114bda8ad3ee8`.
- #719 exact reconciled head `1c46017eb72765aa0dad34f5f6613f4a6091c751`: two-file diff, Hosted CI #2041 green, Rust/RustSec #4416 green, zero review threads; merged as `9738f653525eb06b2b87d5eacb81c47aef6fa0bc`.
- #720 exact current-main validation head `f354aa7b5c9515e2f67b6c55cb91bd187529066f`: two-file diff, Hosted CI #2043 green, Rust/RustSec #4419 green, zero review threads; merged as `bb85ae3a8998950f42ca9ed2060eb182928ec807`.
- #721 exact current-main validation head `6370409126837c014081be0a1e758b2db83672d7`: two-file diff, Hosted CI #2045 green, Rust/RustSec #4422 green, zero review threads; merged as `195d3439d4b599abf722d8e9fda89ccdf110e222`.

## Production truth is unchanged

These repository and CI changes did not activate production execution.

Preserved boundaries:

- durable customer-priority foundation: deployed dormant;
- queue processing: OFF;
- customer priority: OFF;
- provider execution: OFF;
- subscription/production billing: OFF;
- real-charge authorization: none;
- no live provider credential use or provider calls;
- no customer source execution through the dormant priority path;
- Repository Audit write/remediation: disabled;
- Server Audit mutation/remediation: disabled.

Production-sensitive actions still require fresh explicit owner approval.
