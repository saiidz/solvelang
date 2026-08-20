# SolveLang Current Production Status — 2026-08-20

This record supersedes `docs/current-production-status-2026-08-19.md` for the production TOTP/KMS/IAM facts explicitly re-verified below. It does not silently re-audit unrelated production features.

Repository merges remain separate from live production state. A merged workflow or policy file is not by itself evidence that a production mutation occurred.

## Read-only owner audit on 2026-08-20

The owner re-verified the live production account/API TOTP foundation in AWS account `817198673108`, Region `us-east-2`, without performing an IAM, KMS, CloudFormation, customer, billing, email, or charge mutation.

Verified live API stack facts for `solvelang-api-access-production`:

- API access: **enabled**;
- customer accounts: **enabled**;
- customer authenticator TOTP feature flag: **enabled**;
- subscription billing: **disabled**;
- `CustomerTotpKmsKeyArn` exactly matches the dedicated TOTP KMS stack output.

The earlier 2026-08-19 status text that said the production TOTP rollout was not completed is stale and must not be used as the current TOTP infrastructure truth.

## Dedicated production TOTP KMS foundation

The dedicated stack `solvelang-api-access-production-totp-kms` is live and was re-verified as:

- stack status: `CREATE_COMPLETE`;
- CloudFormation termination protection: **enabled**;
- stable alias: `alias/solvelang-customer-totp-production`;
- key manager: **CUSTOMER**;
- key state: **Enabled**;
- key spec: `SYMMETRIC_DEFAULT`;
- key usage: `ENCRYPT_DECRYPT`;
- origin: `AWS_KMS`;
- multi-Region: **false**;
- automatic key rotation: **enabled**;
- rotation period: 365 days;
- tags:
  - `Project=SolveLang`;
  - `Purpose=customer-totp`;
  - `Environment=production`.

The stable alias resolves to the same key ARN that the API stack references.

## Production GitHub OIDC IAM supplements

The two expected TOTP supplemental inline policies are already attached to the existing production OIDC roles:

- preflight role `solvelang-api-production-preflight`:
  - `SolveLangProductionTotpPreflightSupplement`;
- deploy role `SolveLangProductionFoundationDeploy`:
  - `SolveLangProductionTotpDeploySupplement`.

The owner audit did not rewrite or replace either policy.

CloudTrail review of recent CloudFormation mutations showed the production executions in the sampled history were performed as `GitHubActions` through `arn:aws:iam::817198673108:role/SolveLangProductionFoundationDeploy`, not through an unknown principal or an owner root session.

## Important distinction: feature availability vs account enrollment

`CustomerTotpEnabled=true` means the production application supports customer authenticator-app TOTP. It does **not** prove that the owner account or any specific customer account has enrolled an authenticator.

The 2026-08-19 private Admin read-only canary reported the owner account's authenticator-app TOTP state as disabled at that time. The 2026-08-20 AWS infrastructure audit did not mutate or re-read the owner account's customer-auth enrollment record.

Therefore the next TOTP customer-security action, if desired, is an explicitly owner-approved enrollment/login/backup-code canary. Do not repeat the already-live IAM/KMS/API infrastructure rollout merely because older documentation described it as pending.

## Preserved production boundaries

The 2026-08-20 audit directly re-verified subscription billing as **disabled**. It did not authorize or perform:

- Stripe configuration or webhook activation;
- charges or refunds;
- paid-priority activation;
- provider/worker activation;
- Repository Audit write/remediation mode;
- Server Audit mutation/remediation mode;
- customer/CRM mutation;
- TOTP account enrollment;
- email sending.

Previously verified private Admin and customer-account state remains governed by the relevant production-status/runbook records unless separately re-probed.

## Truthfulness rule

Production documentation must continue to distinguish:

- implementation merged in code;
- infrastructure deployed;
- feature enabled for the environment;
- feature enrolled/activated for a specific account;
- separately owner-authorized production mutations.

For TOTP specifically, the current infrastructure truth is **deployed and environment-enabled**, while specific customer enrollment remains a separate account-level state.
