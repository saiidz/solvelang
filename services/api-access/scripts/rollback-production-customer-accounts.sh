#!/usr/bin/env bash
set -euo pipefail

DISABLED_TOTP_KMS_ARN="arn:aws:kms:us-east-1:000000000000:key/disabled"

for value in "$INITIAL_API_ACCESS_ENABLED" "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" "$INITIAL_CUSTOMER_TOTP_ENABLED"; do
  [[ "$value" == true || "$value" == false ]] || { echo "Rollback feature state must be true or false." >&2; exit 1; }
done
[[ "$INITIAL_API_ACCESS_ENABLED" == "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" ]] || {
  echo "Rollback requires the original API access and customer-account flags to match." >&2
  exit 1
}
[[ "$INITIAL_CUSTOMER_TOTP_ENABLED" == false || "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" == true ]] || {
  echo "Rollback cannot enable authenticator 2FA while customer accounts are disabled." >&2
  exit 1
}

INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN="${INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN:-$DISABLED_TOTP_KMS_ARN}"
[[ "$INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN" =~ ^arn:[a-z0-9-]+:kms:[a-z0-9-]+:[0-9]{12}:key/.+$ ]] || {
  echo "Rollback authenticator KMS key ARN is malformed." >&2
  exit 1
}
if [[ "$INITIAL_CUSTOMER_TOTP_ENABLED" == true && "$INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN" == "$DISABLED_TOTP_KMS_ARN" ]]; then
  echo "Rollback authenticator 2FA requires the original production KMS key ARN." >&2
  exit 1
fi

parameter_overrides=(
  ApiAccessEnabled="$INITIAL_API_ACCESS_ENABLED"
  ApiAccessMode="live"
  CustomerAccountsEnabled="$INITIAL_CUSTOMER_ACCOUNTS_ENABLED"
  CustomerTotpEnabled="$INITIAL_CUSTOMER_TOTP_ENABLED"
  CustomerTotpKmsKeyArn="$INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN"
  SubscriptionBillingEnabled="false"
  SiteOrigin="$SITE_ORIGIN"
  ApiKeyPepper="$API_KEY_PEPPER"
  ApiAccessAdminSecret="$API_ACCESS_ADMIN_SECRET"
  CustomerAuthPepper="$CUSTOMER_AUTH_PEPPER"
  CustomerAuthEmailSender="$CUSTOMER_AUTH_EMAIL_SENDER"
)
[[ -z "$CUSTOMER_AUTH_EMAIL_REPLY_TO" ]] || parameter_overrides+=(CustomerAuthEmailReplyTo="$CUSTOMER_AUTH_EMAIL_REPLY_TO")

sam deploy \
  --stack-name "$STACK_NAME" \
  --s3-bucket "$SAM_ARTIFACT_BUCKET" \
  --s3-prefix "$STACK_NAME-rollback" \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${parameter_overrides[@]}"

response="$(curl --fail --silent --show-error "$API_BASE/health")"
jq -e \
  --argjson api_access "$INITIAL_API_ACCESS_ENABLED" \
  --argjson customer_accounts "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" \
  --argjson customer_totp "$INITIAL_CUSTOMER_TOTP_ENABLED" \
  '.status == "ok" and .enabled == $api_access and .customerAccountsEnabled == $customer_accounts and .customerTotpEnabled == $customer_totp and .subscriptionBillingEnabled == false' \
  <<<"$response" >/dev/null
