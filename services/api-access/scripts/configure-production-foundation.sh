#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:?stack name is required}"
AWS_REGION="${2:?AWS region is required}"
ALARM_TOPIC_ARN="${3:?alarm topic ARN is required}"

[[ "$STACK_NAME" == *prod* || "$STACK_NAME" == *production* ]]
[[ "$STACK_NAME" != *test* ]]
[[ "$ALARM_TOPIC_ARN" == arn:aws:sns:${AWS_REGION}:*:* ]]

physical_id() {
  aws cloudformation describe-stack-resource \
    --stack-name "$STACK_NAME" \
    --logical-resource-id "$1" \
    --query 'StackResourceDetail.PhysicalResourceId' \
    --output text
}

# Every production table gets point-in-time recovery. TTL semantics remain enforced by application timestamps.
for logical_id in \
  ApiAccountsTable \
  ApiKeysTable \
  ApiUsageTable \
  ApiUsageIdempotencyTable \
  ApiSubscriptionEventsTable \
  ApiCustomerAuthTable
do
  table_name="$(physical_id "$logical_id")"
  test -n "$table_name"
  aws dynamodb update-continuous-backups \
    --table-name "$table_name" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
    >/dev/null
  state="$(aws dynamodb describe-continuous-backups \
    --table-name "$table_name" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text)"
  [[ "$state" == ENABLED ]]
done

ensure_log_retention() {
  local function_name="$1"
  local log_group="/aws/lambda/${function_name}"
  if ! aws logs describe-log-groups \
      --log-group-name-prefix "$log_group" \
      --query 'logGroups[?logGroupName==`'"$log_group"'`].logGroupName' \
      --output text | grep -qx "$log_group"; then
    aws logs create-log-group --log-group-name "$log_group"
  fi
  aws logs put-retention-policy --log-group-name "$log_group" --retention-in-days 90
  retention="$(aws logs describe-log-groups \
    --log-group-name-prefix "$log_group" \
    --query 'logGroups[?logGroupName==`'"$log_group"'`].retentionInDays | [0]' \
    --output text)"
  [[ "$retention" == 90 ]]
}

API_FUNCTION="$(physical_id ApiAccessFunction)"
AUTHORIZER_FUNCTION="$(physical_id ApiKeyAuthorizerFunction)"
ensure_log_retention "$API_FUNCTION"
ensure_log_retention "$AUTHORIZER_FUNCTION"

put_lambda_alarm() {
  local name="$1" metric="$2" function_name="$3" threshold="$4" statistic="$5"
  aws cloudwatch put-metric-alarm \
    --alarm-name "${STACK_NAME}-${name}" \
    --alarm-description "SolveLang production ${name}" \
    --namespace AWS/Lambda \
    --metric-name "$metric" \
    --dimensions "Name=FunctionName,Value=${function_name}" \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold "$threshold" \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --statistic "$statistic" \
    --treat-missing-data notBreaching \
    --alarm-actions "$ALARM_TOPIC_ARN"
}

put_lambda_alarm api-errors Errors "$API_FUNCTION" 1 Sum
put_lambda_alarm api-throttles Throttles "$API_FUNCTION" 1 Sum
put_lambda_alarm api-duration Duration "$API_FUNCTION" 12000 Maximum
put_lambda_alarm authorizer-errors Errors "$AUTHORIZER_FUNCTION" 1 Sum
put_lambda_alarm authorizer-throttles Throttles "$AUTHORIZER_FUNCTION" 1 Sum
put_lambda_alarm authorizer-duration Duration "$AUTHORIZER_FUNCTION" 4000 Maximum

for alarm in \
  api-errors \
  api-throttles \
  api-duration \
  authorizer-errors \
  authorizer-throttles \
  authorizer-duration
do
  actions="$(aws cloudwatch describe-alarms \
    --alarm-names "${STACK_NAME}-${alarm}" \
    --query 'MetricAlarms[0].AlarmActions[0]' \
    --output text)"
  [[ "$actions" == "$ALARM_TOPIC_ARN" ]]
done
