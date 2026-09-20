# Production API maintenance

Use `Deploy API Access Production Maintenance` for reviewed code/Studio route
updates to the existing `solvelang-api-access-production` stack. Do not reuse
first-activation workflows, which have different feature-state assumptions.

The workflow is manual, main-only, protected by the `api-access-production`
environment, and participates in the shared FIFO deployment queue. It uses the
existing deployment role and encrypted artifact bucket. It receives no Stripe,
account-authentication, or API-key secrets.

1. Merge the reviewed candidate with all applicable checks green.
2. Dispatch with `execute_maintenance=false` to package and inspect the real
   CloudFormation change set. This uploads code and creates a retained change set
   but does not execute a stack update.
3. Inspect the retained change-set ARN and resource list in the Actions summary.
   Check the exact commit and validated scope, then dispatch that reviewed main
   commit with `execute_maintenance=true` under deployment authorization.
4. Verify unchanged parameter values/health flags and the Studio route's 401
   response without a customer session. Retain the Actions run as evidence.
5. Complete authenticated two-account/cross-device acceptance before setting
   `NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED=true` in the site build.

Every existing parameter uses `UsePreviousValue`, including secrets and enabled
billing/TOTP/CRM flags. Parameter additions/removals, IAM/data-resource changes,
resource replacements, non-resource template changes (including Outputs, Rules,
Conditions and parameter definitions), and unrelated route permissions fail closed. Allowed
changes are the two existing Lambda code packages, the API body, and the two
Studio invoke permissions. This intentionally narrow path may reject other
maintenance work; expand it only through a separately reviewed requirement.

CloudFormation performs its normal automatic rollback if an update fails.
If the update finishes but health/parameter/Studio-auth checks fail, the script
restores the previous processed template and verifies baseline health again.
Rollback failure fails the workflow and requires operator recovery; no success
claim or frontend activation follows a failed run. An empty or unexpected change
set also fails safely and needs inspection, rather than being treated as proof.

This workflow does not charge customers, activate a provider, change live
configuration, or qualify authenticated Studio behavior by itself.

## Preserve deployed operational settings

The first real preview (run 35529275426) refused a proposed CRM table change
and did not execute a stack update. SAM source defaults can differ from live
operational hardening. Maintenance therefore expands SAM in a non-executed
compilation change set, then creates a second template from the deployed
processed template, copying only the two Lambda Code properties, the API Body,
and the two new Studio permissions. Existing data/IAM/feature settings remain
byte-for-byte equivalent after canonical comparison. Stack-level edits and
unrelated resource additions/removals are still rejected. The final projected
change set undergoes the same resource and complete-template validation before
it can be executed.

## Verified production execution — 2026-09-20

At main `632b6ff82f2f54babe46e4e11e672675e4ca838e`,
[plan 35530924473](https://github.com/saiidz/solvelang/actions/runs/35530924473)
validated exactly five allowed changes.
[Execution 35531150309](https://github.com/saiidz/solvelang/actions/runs/35531150309)
then completed successfully: two Lambda code updates, API routes and two Studio
invoke permissions. Every existing parameter and checked health/feature flag
was preserved; the new Studio GET rejected an unauthenticated request with 401.
No rollback was needed. This does not establish authenticated account roundtrips.
