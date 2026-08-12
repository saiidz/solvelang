#!/usr/bin/env bash
set -euo pipefail

error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT

if ! stack_description="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --output json 2>"$error_file")"; then
  if grep -Fq 'does not exist' "$error_file"; then
    echo "Production stack does not exist yet; an inert foundation may be created."
    exit 0
  fi
  cat "$error_file" >&2
  exit 1
fi

status="$(jq -r '.Stacks[0].StackStatus // empty' <<<"$stack_description")"
[[ "$status" == CREATE_COMPLETE || "$status" == UPDATE_COMPLETE ]] || {
  echo "Production foundation requires a stable stack; found $status." >&2
  exit 1
}

parameter_value() {
  local name="$1"
  jq -r --arg name "$name" '[.Stacks[0].Parameters[]? | select(.ParameterKey == $name) | .ParameterValue] | first // empty' <<<"$stack_description"
}

api_access_enabled="$(parameter_value ApiAccessEnabled)"
customer_accounts_enabled="$(parameter_value CustomerAccountsEnabled)"
subscription_billing_enabled="$(parameter_value SubscriptionBillingEnabled)"

[[ "$subscription_billing_enabled" == false ]] || {
  echo "Production subscription billing must remain disabled." >&2
  exit 1
}
[[ "$api_access_enabled" == false && "$customer_accounts_enabled" == false ]] || {
  echo "Production foundation refuses to overwrite feature state ${api_access_enabled}/${customer_accounts_enabled}; the stack must already be false/false." >&2
  exit 1
}
