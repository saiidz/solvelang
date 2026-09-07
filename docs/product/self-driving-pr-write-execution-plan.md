# Self-Driving PR write execution plan v0

Status: **repository-safe no-write planning boundary; no GitHub executor or credential activation**.

`solvelang.self-driving.pr-write-execution-plan.v0` is the next gate after the single-use, SHA-256-bound PR write claim. It converts already-reviewed Suggest → Patch Preview → Patch Validation → PR Preflight → Write Approval → Claim evidence into one bounded execution requirement artifact. It still performs no repository or network write.

## Canonical source recreation

Before a plan is emitted, the boundary recreates and byte-compares the supplied canonical Patch Preview, Patch Validation, and PR Preflight from their source data. It then normalizes the write approval again and recomputes its SHA-256 binding. A forged upstream execution count, policy, proposal identity, ordering, validation artifact, preflight, or substituted approval is rejected.

Only a successful `solvelang.self-driving.pr-write-claim.v0` with the safe claim policy is accepted. The claim's `approvalBindingSha256`, approval ID, preflight ID, and claimed timestamp must bind to the normalized approval.

## Selected patch set

Only proposals selected by the canonical PR preflight enter the plan. Every selected Patch Preview identity must match the validation/preflight evidence.

The v0 execution-plan limits are intentionally narrower than Patch Preview storage limits:

- at most 25 selected proposals;
- at most 50 files;
- at most 256 hunks;
- at most 2,500 patch lines;
- at most 131,072 patch bytes.

Two selected proposals may not target the same file. Each file retains its exact reviewed base blob SHA and structured text hunks.

## Required live checks

A later GitHub executor must fail closed unless it performs all four live checks immediately before writing:

1. verify the protected base branch still resolves to the exact reviewed base revision;
2. verify fresh branch-protection/ruleset state remains compatible with the approved preflight;
3. verify the proposed head branch does not already exist;
4. verify every target file still has the exact reviewed base blob SHA.

These requirements are represented only. This module does not perform them because it has no network or GitHub access.

## Authority boundary

The plan requires future least-privilege `metadata:read`, `contents:write`, and `pullRequests:write` authority only for a separate executor. The current module has no credential resolver, GitHub API client, network access, branch creation, commit write, patch application, pull-request creation, direct protected-branch push, force push, automatic merge, shell execution, production/billing/provider mutation, or Solve Runner authority.

A later executor must remain one-shot and bounded to `create-branch` → `create-commit` → `open-pr`, revalidate the live checks above, sanitize all failures, never auto-merge, and terminally consume/finalize the claimed authorization. Production activation of any credential-bearing executor remains separate from repository implementation.
