# SolveLang Active Buildout Handoff

**Purpose:** durable cross-chat execution state for the approved full SolveLang buildout.  
**Owner master authorization:** `APPROVE FULL SOLVELANG BUILDOUT PLAN`  
**Current production-mutating gates remain separate:** merge, AWS/KMS mutation, production preflight dispatch, production deployment, email canary, Stripe/billing enablement, and any real charge.

## Exact current repository state

- Repository: `saiidz/solvelang`
- Current production-code merge on `main`: `72219f057568c1cd8e3666950f67a0018ab9d252`
- Merge: PR #141, optional authenticator-app 2FA implementation
- Post-merge workflows on that exact SHA: API Access CI, CI, and Rust/RustSec all passed
- Current active rollout-preparation branch: `agent/totp-production-rollout-prep`
- Production API stack: `solvelang-api-access-production`
- Production region: `us-east-2`
- Current production API access: enabled
- Current production customer accounts: enabled
- Current production subscription billing: disabled
- Current production authenticator 2FA: not enabled yet
- No production TOTP KMS key has been authorized for creation by this master coding approval alone

## Master execution sequence

1. Finish optional authenticator 2FA production rollout package and canary.
2. Add centralized account suspension/termination enforcement.
3. Finish remaining customer-account/security hardening and truth documentation.
4. Clean stale/superseded project documentation and PR state.
5. Finish production billing preparation, then separately gate live Stripe activation and any charge.
6. Finish and validate queue-backed paid-priority execution before exposing paid priority choices.
7. Build Repository Audit in staged read-only then approval-based remediation phases.
8. Build Server Audit in staged read-only then approval-based remediation phases.
9. Perform final production/IAM/rollback/operations hardening.
10. Run final launch-readiness canaries and produce an exact live-state record.

## Current stage: authenticator production rollout preparation

The implementation already merged in PR #141 provides:

- RFC 6238-compatible 6-digit TOTP;
- unique 20-byte enrollment secret;
- KMS secret protector with account-bound encryption context;
- staged password/magic-link first factor followed by MFA challenge;
- no full session before the second factor succeeds;
- 5-minute challenge TTL and bounded attempts;
- ten one-time backup codes stored only as keyed fingerprints;
- TOTP time-step replay prevention;
- `authVersion` session invalidation for security changes;
- fail-closed malformed/partial TOTP-state handling;
- optional feature flag defaulting off.

This rollout-preparation branch must finish before any production 2FA enablement:

- dedicated retained/rotating production KMS stack IaC;
- narrowly scoped production deploy-role policy contract for that KMS stack;
- hosted validation of KMS IaC;
- validation-only production TOTP preflight workflow;
- dedicated protected TOTP production deployment workflow;
- state-preserving rollback including the TOTP flag and KMS ARN;
- ordinary customer-account redeploys must preserve existing TOTP state rather than resetting it;
- health output must expose the TOTP feature state for deterministic preflight/rollback verification;
- regression tests for every rollout and rollback contract;
- rollout documentation and exact manual approval sequence.

## Hard safety boundary for this active branch

Allowed under the master coding approval:

- create/update isolated branches;
- code, tests, docs, workflows, and IaC;
- run hosted CI automatically triggered by branch/PR changes;
- diagnose and fix CI/review findings;
- open/update PRs.

Not allowed without a fresh explicit gate:

- merge a rollout PR;
- apply or mutate the live AWS deploy-role policy;
- create/update the production KMS stack;
- dispatch a protected production preflight;
- deploy production API changes;
- enroll or mutate the production owner account;
- send a canary/recovery email;
- enable subscription billing or Stripe/webhooks;
- perform a real charge.

## Cross-chat continuation

When a conversation reaches its practical limit, start a new chat inside the same Solve project and say:

`continue SolveLang full buildout from docs/active-buildout-handoff.md`

The new chat should read this file and verify current GitHub state before taking the next action. Never trust the handoff alone if GitHub has drifted; compare current `main`, active PR heads, CI conclusions, and unresolved review threads first.
