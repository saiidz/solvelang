#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:?stack name is required}"
AWS_REGION="${2:?AWS region is required}"

[[ "$STACK_NAME" == *prod* || "$STACK_NAME" == *production* ]]
[[ "$STACK_NAME" != *test* ]]

physical_id() {
  aws cloudformation describe-stack-resource \
    --stack-name "$STACK_NAME" \
    --logical-resource-id "$1" \
    --region "$AWS_REGION" \
    --query 'StackResourceDetail.PhysicalResourceId' \
    --output text
}

verify_table() {
  local logical_id="$1"
  local table_name
  table_name="$(physical_id "$logical_id")"
  test -n "$table_name"
  [[ "$table_name" != None ]]

  local table_json backups_json
  table_json="$(aws dynamodb describe-table \
    --table-name "$table_name" \
    --region "$AWS_REGION" \
    --output json)"
  backups_json="$(aws dynamodb describe-continuous-backups \
    --table-name "$table_name" \
    --region "$AWS_REGION" \
    --output json)"

  jq -e '.Table.TableStatus == "ACTIVE"' <<<"$table_json" >/dev/null
  jq -e '.Table.SSEDescription.Status == "ENABLED"' <<<"$table_json" >/dev/null
  jq -e '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus == "ENABLED"' <<<"$backups_json" >/dev/null
  jq -e '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime != null' <<<"$backups_json" >/dev/null
  jq -e '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.LatestRestorableDateTime != null' <<<"$backups_json" >/dev/null

  jq -n \
    --arg logicalId "$logical_id" \
    --arg tableName "$table_name" \
    --arg tableStatus "$(jq -r '.Table.TableStatus' <<<"$table_json")" \
    --arg sseStatus "$(jq -r '.Table.SSEDescription.Status' <<<"$table_json")" \
    --arg pitrStatus "$(jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' <<<"$backups_json")" \
    --arg earliest "$(jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime' <<<"$backups_json")" \
    --arg latest "$(jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.LatestRestorableDateTime' <<<"$backups_json")" \
    '{logicalId:$logicalId,tableName:$tableName,tableStatus:$tableStatus,sseStatus:$sseStatus,pitrStatus:$pitrStatus,earliestRestorableDateTime:$earliest,latestRestorableDateTime:$latest}'
}

# These tables contain durable customer identity, entitlement/subscription state,
# API-key state, authentication/TOTP state, and webhook replay protection.
for logical_id in \
  ApiAccountsTable \
  ApiKeysTable \
  ApiCustomerAuthTable \
  ApiSubscriptionEventsTable
do
  verify_table "$logical_id"
done

# This verifier is intentionally read-only. A restore, table replacement, stack
# update, or production cutover requires a separately approved recovery action.
