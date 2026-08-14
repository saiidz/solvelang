# Production TOTP IAM Policy Update

**Status:** prepared; live IAM mutation requires separate explicit owner approval.

This runbook updates the two existing GitHub OIDC roles by adding **supplemental inline policies only**. It does not replace or remove the roles' current policies, so existing password-auth/customer-account production permissions remain intact.

Tracked supplemental policies:

- `ops/aws/production-totp-preflight-supplemental-policy.json`
- `ops/aws/production-totp-deploy-supplemental-policy.json`

Read-only verifier:

- `ops/aws/verify-production-totp-role-supplements.sh`

Fixed inline policy names:

- `SolveLangProductionTotpPreflightSupplement`
- `SolveLangProductionTotpDeploySupplement`

## Safety properties

The preflight supplement is read/validation-only for the dedicated production TOTP KMS stack/key.

The deploy supplement permits only the incremental CloudFormation/KMS authority required to create and prove the dedicated tagged production TOTP KMS key and alias. It does **not** grant:

- `kms:Encrypt`
- `kms:Decrypt`
- `kms:DisableKey`
- `kms:ScheduleKeyDeletion`
- `kms:CancelKeyDeletion`
- `kms:PutKeyPolicy`
- `kms:DisableKeyRotation`
- any `iam:*` action

The existing production deploy role must not be used to modify its own IAM policy. Apply this gate from an owner-controlled AWS administrator/CloudShell identity that is separate from both target OIDC roles.

## Inputs

Use the exact role ARNs already configured in the protected GitHub Environment:

```text
PREFLIGHT_ROLE_ARN=<the role stored as AWS_ROLE_ARN>
DEPLOY_ROLE_ARN=<the role stored as AWS_DEPLOY_ROLE_ARN>
```

Do not paste role credentials or GitHub secrets into the repository or chat. Role ARNs are identifiers, not credentials.

## Gate 1 — read-only verification

From a clean checkout of the exact merged `main` commit, export the two role ARNs and run:

```bash
export PREFLIGHT_ROLE_ARN='arn:aws:iam::<account-id>:role/<preflight-role>'
export DEPLOY_ROLE_ARN='arn:aws:iam::<account-id>:role/<deploy-role>'

bash ops/aws/verify-production-totp-role-supplements.sh
```

The verifier checks:

- both ARNs are valid, distinct IAM roles in the same AWS account;
- the current AWS caller is in that account;
- both roles still trust only GitHub OIDC for `repo:saiidz/solvelang:environment:api-access-production` with audience `sts.amazonaws.com`;
- both supplemental JSON documents parse;
- the preflight supplement remains read/validation-only;
- the deploy supplement contains the tagged KMS bootstrap constraint;
- forbidden cryptographic/destructive KMS actions are absent;
- no IAM mutation permission is present.

It performs no AWS mutation.

## Gate 2 — collision check before any write

Extract the role names only after the read-only verification succeeds:

```bash
PREFLIGHT_ROLE_NAME="${PREFLIGHT_ROLE_ARN##*/}"
DEPLOY_ROLE_NAME="${DEPLOY_ROLE_ARN##*/}"

aws iam list-role-policies --role-name "$PREFLIGHT_ROLE_NAME" --output json
aws iam list-role-policies --role-name "$DEPLOY_ROLE_NAME" --output json
```

If either fixed policy name already exists, **do not overwrite it blindly**. Retrieve it and compare it to the tracked file:

```bash
aws iam get-role-policy \
  --role-name "$PREFLIGHT_ROLE_NAME" \
  --policy-name SolveLangProductionTotpPreflightSupplement \
  --query PolicyDocument \
  --output json | jq -S .

jq -S . ops/aws/production-totp-preflight-supplemental-policy.json
```

Repeat for `SolveLangProductionTotpDeploySupplement` and the deploy supplemental file. If an existing policy differs, stop and investigate.

## Gate 3 — live IAM mutation

This section requires the separate owner approval:

```text
APPROVE LIVE TOTP IAM POLICY UPDATE
```

After that approval only, an owner-controlled AWS administrator may run:

```bash
aws iam put-role-policy \
  --role-name "$PREFLIGHT_ROLE_NAME" \
  --policy-name SolveLangProductionTotpPreflightSupplement \
  --policy-document file://ops/aws/production-totp-preflight-supplemental-policy.json

aws iam put-role-policy \
  --role-name "$DEPLOY_ROLE_NAME" \
  --policy-name SolveLangProductionTotpDeploySupplement \
  --policy-document file://ops/aws/production-totp-deploy-supplemental-policy.json
```

These commands add/replace only the two fixed supplemental inline policy names. They do not modify the role trust policies and do not remove any existing policy.

## Gate 4 — exact post-write verification

Immediately retrieve both policies and compare canonical JSON:

```bash
aws iam get-role-policy \
  --role-name "$PREFLIGHT_ROLE_NAME" \
  --policy-name SolveLangProductionTotpPreflightSupplement \
  --query PolicyDocument \
  --output json | jq -S -c . > /tmp/live-preflight-totp-policy.json

jq -S -c . ops/aws/production-totp-preflight-supplemental-policy.json > /tmp/repo-preflight-totp-policy.json
cmp /tmp/live-preflight-totp-policy.json /tmp/repo-preflight-totp-policy.json

aws iam get-role-policy \
  --role-name "$DEPLOY_ROLE_NAME" \
  --policy-name SolveLangProductionTotpDeploySupplement \
  --query PolicyDocument \
  --output json | jq -S -c . > /tmp/live-deploy-totp-policy.json

jq -S -c . ops/aws/production-totp-deploy-supplemental-policy.json > /tmp/repo-deploy-totp-policy.json
cmp /tmp/live-deploy-totp-policy.json /tmp/repo-deploy-totp-policy.json
```

Then rerun:

```bash
bash ops/aws/verify-production-totp-role-supplements.sh
```

The verifier still performs no mutation; it confirms role identity/trust and policy contracts.

## Reversal before KMS creation

If the IAM gate must be reversed before the KMS bootstrap, first verify that the live supplemental documents still exactly match the tracked files. Then, with separate explicit approval, remove only these two supplemental names:

```bash
aws iam delete-role-policy \
  --role-name "$PREFLIGHT_ROLE_NAME" \
  --policy-name SolveLangProductionTotpPreflightSupplement

aws iam delete-role-policy \
  --role-name "$DEPLOY_ROLE_NAME" \
  --policy-name SolveLangProductionTotpDeploySupplement
```

Never delete or replace unrelated inline/managed policies on either role.

## Next gate

Once both supplements are proven exact, the next mutation remains separate:

```text
Deploy API Access Production TOTP KMS
```

That workflow creates/proves only the retained dedicated KMS stack while production TOTP remains disabled.
