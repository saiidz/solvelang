#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFLIGHT_POLICY_FILE="$REPO_ROOT/ops/aws/production-totp-preflight-supplemental-policy.json"
DEPLOY_POLICY_FILE="$REPO_ROOT/ops/aws/production-totp-deploy-supplemental-policy.json"
EXPECTED_SUBJECT="repo:saiidz/solvelang:environment:api-access-production"

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in aws jq; do command -v "$command" >/dev/null || fail "$command is required."; done
[[ -f "$PREFLIGHT_POLICY_FILE" && -f "$DEPLOY_POLICY_FILE" ]] || fail "Repository IAM supplement policy files are missing."

PREFLIGHT_ROLE_ARN="${PREFLIGHT_ROLE_ARN:-}"
DEPLOY_ROLE_ARN="${DEPLOY_ROLE_ARN:-}"
[[ -n "$PREFLIGHT_ROLE_ARN" && -n "$DEPLOY_ROLE_ARN" ]] || fail "PREFLIGHT_ROLE_ARN and DEPLOY_ROLE_ARN are required."
[[ "$PREFLIGHT_ROLE_ARN" != "$DEPLOY_ROLE_ARN" ]] || fail "Preflight and deploy roles must be distinct."

parse_role_arn() {
  local arn="$1"
  [[ "$arn" =~ ^arn:(aws[a-zA-Z-]*):iam::([0-9]{12}):role/(.+)$ ]] || fail "Invalid IAM role ARN: $arn"
  PARSED_PARTITION="${BASH_REMATCH[1]}"
  PARSED_ACCOUNT="${BASH_REMATCH[2]}"
  PARSED_ROLE_NAME="${BASH_REMATCH[3]##*/}"
}

parse_role_arn "$PREFLIGHT_ROLE_ARN"
PARTITION="$PARSED_PARTITION"
ACCOUNT_ID="$PARSED_ACCOUNT"
PREFLIGHT_ROLE_NAME="$PARSED_ROLE_NAME"
parse_role_arn "$DEPLOY_ROLE_ARN"
[[ "$PARSED_PARTITION" == "$PARTITION" && "$PARSED_ACCOUNT" == "$ACCOUNT_ID" ]] || fail "Target roles must be in the same AWS account and partition."
DEPLOY_ROLE_NAME="$PARSED_ROLE_NAME"

caller="$(aws sts get-caller-identity --output json)"
[[ "$(jq -r '.Account // empty' <<<"$caller")" == "$ACCOUNT_ID" ]] || fail "AWS caller account does not match target role account."

verify_role_trust() {
  local role_arn="$1" role_name="$2" role_json
  role_json="$(aws iam get-role --role-name "$role_name" --output json)"
  [[ "$(jq -r '.Role.Arn // empty' <<<"$role_json")" == "$role_arn" ]] || fail "Resolved role ARN does not match $role_arn."

  jq -e --arg subject "$EXPECTED_SUBJECT" '
    .Role.AssumeRolePolicyDocument.Statement as $statements
    | [$statements[] | select(.Effect == "Allow")] as $allows
    | ($allows | length) == 1
    and ($allows[0].Action == "sts:AssumeRoleWithWebIdentity"
      or (($allows[0].Action | type) == "array"
        and ($allows[0].Action | length) == 1
        and $allows[0].Action[0] == "sts:AssumeRoleWithWebIdentity"))
    and (($allows[0].Principal | keys | sort) == ["Federated"])
    and (($allows[0].Principal.Federated | type) == "string")
    and ($allows[0].Principal.Federated | endswith(":oidc-provider/token.actions.githubusercontent.com"))
    and ($allows[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com")
    and (
      $allows[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == $subject
      or $allows[0].Condition.StringLike["token.actions.githubusercontent.com:sub"] == $subject
    )
    and (($allows[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] // $subject) == $subject)
    and (($allows[0].Condition.StringLike["token.actions.githubusercontent.com:sub"] // $subject) == $subject)
  ' <<<"$role_json" >/dev/null || fail "$role_name has an unexpected or broader Allow trust grant."
}

verify_role_trust "$PREFLIGHT_ROLE_ARN" "$PREFLIGHT_ROLE_NAME"
verify_role_trust "$DEPLOY_ROLE_ARN" "$DEPLOY_ROLE_NAME"

jq -e '.Version == "2012-10-17" and (.Statement | type == "array") and (.Statement | length > 0)' "$PREFLIGHT_POLICY_FILE" >/dev/null
jq -e '.Version == "2012-10-17" and (.Statement | type == "array") and (.Statement | length > 0)' "$DEPLOY_POLICY_FILE" >/dev/null

preflight_actions="$(jq -r '[.Statement[].Action] | flatten[]' "$PREFLIGHT_POLICY_FILE")"
while IFS= read -r action; do
  [[ "$action" =~ ^cloudformation:(Describe|Get|List) || "$action" == "cloudformation:ValidateTemplate" || "$action" =~ ^kms:(Describe|Get|List) ]] \
    || fail "Preflight supplement contains mutating action: $action"
done <<<"$preflight_actions"

deploy_actions="$(jq -r '[.Statement[].Action] | flatten[]' "$DEPLOY_POLICY_FILE")"
for forbidden in 'kms:Encrypt' 'kms:Decrypt' 'kms:DisableKey' 'kms:ScheduleKeyDeletion' 'kms:CancelKeyDeletion' 'kms:PutKeyPolicy' 'kms:DisableKeyRotation' 'kms:*'; do
  ! grep -Fxq "$forbidden" <<<"$deploy_actions" || fail "Deploy supplement contains forbidden KMS action: $forbidden"
done
! grep -Eq '^iam:' <<<"$deploy_actions" || fail "Deploy supplement must not grant IAM mutation permissions."

jq -e '
  [.Statement[] | select(.Action == "kms:CreateKey")]
  | length == 1
  and .[0].Resource == "*"
  and .[0].Condition.StringEquals["kms:KeySpec"] == "SYMMETRIC_DEFAULT"
  and .[0].Condition.StringEquals["kms:KeyUsage"] == "ENCRYPT_DECRYPT"
  and .[0].Condition.StringEquals["aws:RequestTag/Project"] == "SolveLang"
  and .[0].Condition.StringEquals["aws:RequestTag/Purpose"] == "customer-totp"
  and .[0].Condition.StringEquals["aws:RequestTag/Environment"] == "production"
' "$DEPLOY_POLICY_FILE" >/dev/null || fail "Deploy KMS key-creation constraint is invalid."

jq -e '
  ([.Statement[] | select(.Sid == "ManageTaggedProductionTotpKey") | .Action] | first) as $keyActions
  | ([.Statement[] | select(.Sid == "ManageProductionTotpAlias") | .Action] | first) as $aliasActions
  | (["kms:CreateAlias", "kms:DeleteAlias", "kms:UpdateAlias"] | all(. as $action | ($keyActions | index($action)) != null))
  and (["kms:CreateAlias", "kms:DeleteAlias", "kms:UpdateAlias"] | all(. as $action | ($aliasActions | index($action)) != null))
' "$DEPLOY_POLICY_FILE" >/dev/null || fail "Alias operations must be authorized on both the tagged target key and exact alias resource."

printf 'Read-only IAM verification passed.\nAccount: %s\nPreflight role: %s\nDeploy role: %s\nNo AWS resource was changed.\n' "$ACCOUNT_ID" "$PREFLIGHT_ROLE_ARN" "$DEPLOY_ROLE_ARN"
