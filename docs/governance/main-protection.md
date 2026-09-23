# `main` protection contract

Last reconciled: 2026-09-22.

This document defines the repository-side contract for the GitHub ruleset protecting `main`. It does not itself mutate GitHub repository settings. The live ruleset remains authoritative and must be checked after any Settings change.

## Current live ruleset

Ruleset `Protect main` (ID `18206723`) is active for the default branch. A live
read on 2026-09-22 confirmed it enforces:

- branch deletion protection;
- non-fast-forward / force-push protection;
- pull requests before merge, with zero required approving reviews;
- required review-thread resolution; and
- strict, up-to-date status checks for exactly the four contexts below.

No bypass actors are configured. The live ruleset is authoritative; this
repository document does not mutate GitHub settings.

## Safe globally required checks

Only checks whose workflows run for **every pull request to `main`** belong in the global required-check list:

1. `Rust runtime` — `.github/workflows/ci.yml`, job `rust`
2. `Static site` — `.github/workflows/ci.yml`, job `site`
3. `SolveLang Rust security and tests` — `.github/workflows/rust.yml`, job `solvec`
4. `WASM artifact security` — `.github/workflows/wasm-artifact-security.yml`, job `audit`

The machine-readable copy is `ops/governance/main-protection-contract.json`. General CI validates that these workflows remain unfiltered on pull requests and that their check names stay stable.

### Do not globally require path-filtered workflows

These remain important and must be green whenever they are triggered, but they are intentionally **not** safe as global required status checks:

- `MCP CI` — runs only when MCP/plugin paths change;
- `Launch Readiness CI` — runs only when launch/release paths change.

Requiring either globally would leave unrelated pull requests waiting forever for a check that GitHub never schedules.

## Enforced GitHub ruleset

The verified `Protect main` configuration preserves deletion and
non-fast-forward protections and requires:

- require a pull request before merging;
- required approving reviews: **0** while the repository does not have a reliably available non-author reviewer;
- require conversation resolution before merging;
- require status checks before merging;
- require branches to be up to date before merging;
- add exactly the four globally safe required checks listed above.

Using zero required approvals still prevents direct pushes when the pull-request rule is enabled. Increase the approval count only after a non-author reviewer is reliably available; otherwise the repository owner can be locked out of legitimate merges because GitHub does not allow authors to approve their own pull requests.

Do not add bypass actors merely to work around a failing or missing check. Fix the check, its trigger, or the branch instead.

## Verification after a future Settings change

The live read on 2026-09-22 confirmed the configured rules above, including no
bypass actors and zero required approving reviews. After any future Settings
change, read the live ruleset again and confirm all of the following before
calling governance enforcement complete:

- target remains the default branch;
- enforcement is active;
- deletion and non-fast-forward protections remain present;
- pull-request requirement is present;
- required status checks contain exactly the intended always-on checks;
- strict/up-to-date behavior is enabled;
- conversation resolution is required;
- no unexpected bypass actor was added.

Then open a harmless documentation pull request and verify GitHub blocks merging while a required check is pending and allows merging only after the required checks are green and conversations are resolved.

## Change-management rule

If a workflow becomes path-filtered, renamed, split, or removed, update the machine-readable contract and GitHub ruleset in the same reviewed change window. Never leave a globally required status check pointing to a workflow that does not run on every pull request.
