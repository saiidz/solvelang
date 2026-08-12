#!/usr/bin/env bash
set -euo pipefail

for value in "$INITIAL_API_ACCESS_ENABLED" "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED"; do
  [[ "$value" == true || "$value" == false ]] || { echo "Rollback feature state must be true or false." >&2; exit 1; }
done
[[ "$INITIAL_API_ACCESS_ENABLED" == "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" ]] || {
  echo "Rollback requires the original API access and customer-account flags to match." >&2
  exit 1
}

parameter_overrides=(
  ApiAccessEnabled="$INITIAL_API_ACCESS_ENABLED"
  ApiAccessMode="live"
  CustomerAccountsEnabled="$INITIAL_CUSTOMER_ACCOUNTS_ENABLED"
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
  '.status == "ok" and .enabled == $api_access and .customerAccountsEnabled == $customer_accounts and .subscriptionBillingEnabled == false' \
  <<<"$response" >/dev/null
