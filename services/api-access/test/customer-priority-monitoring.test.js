import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL("../customer-priority-production-stack.yaml", import.meta.url);

async function source() { return readFile(templateUrl, "utf8"); }

function resourceBlock(template, logicalId, nextLogicalId) {
  const start = template.indexOf(`  ${logicalId}:`);
  assert.notEqual(start, -1, `${logicalId} missing`);
  const end = nextLogicalId ? template.indexOf(`  ${nextLogicalId}:`, start + 1) : template.length;
  assert.notEqual(end, -1, `${nextLogicalId} missing`);
  return template.slice(start, end);
}

test("priority processing cannot be enabled without an operations alarm destination", async () => {
  const template = await source();
  assert.match(template, /PriorityQueueEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /CustomerPriorityEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProviderExecutionEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /PriorityQueueRequiresAlerts:[\s\S]*?RuleCondition: !Equals \[!Ref PriorityQueueEnabled, "true"\][\s\S]*?!Not \[!Equals \[!Ref OperationsAlarmTopicArn, ""\]\]/);
});

test("every priority lane has bounded backlog and oldest-message-age alarms", async () => {
  const template = await source();
  const lanes = ["Standard", "Express", "Priority", "Critical"];
  for (const [index, lane] of lanes.entries()) {
    const nextLane = lanes[index + 1];
    const backlog = resourceBlock(template, `${lane}BacklogAlarm`, nextLane ? `${nextLane}BacklogAlarm` : "StandardMessageAgeAlarm");
    assert.match(backlog, /Namespace: AWS\/SQS/);
    assert.match(backlog, /MetricName: ApproximateNumberOfMessagesVisible/);
    assert.match(backlog, /EvaluationPeriods: 5/);
    assert.match(backlog, /DatapointsToAlarm: 3/);
    assert.match(backlog, /Threshold: !Ref PriorityQueueBacklogThreshold/);
    assert.match(backlog, /TreatMissingData: notBreaching/);
    assert.match(backlog, /AlarmActions: !If \[AlertsConfigured, \[!Ref OperationsAlarmTopicArn\]/);

    const ageNext = nextLane ? `${nextLane}MessageAgeAlarm` : "StandardDlqAlarm";
    const age = resourceBlock(template, `${lane}MessageAgeAlarm`, ageNext);
    assert.match(age, /MetricName: ApproximateAgeOfOldestMessage/);
    assert.match(age, /EvaluationPeriods: 2/);
    assert.match(age, /Threshold: !Ref PriorityQueueAgeThresholdSeconds/);
    assert.match(age, /TreatMissingData: notBreaching/);
    assert.match(age, /AlarmActions: !If \[AlertsConfigured, \[!Ref OperationsAlarmTopicArn\]/);
  }
  assert.match(template, /PriorityQueueBacklogThreshold:[\s\S]*?Default: 20[\s\S]*?MinValue: 1[\s\S]*?MaxValue: 10000/);
  assert.match(template, /PriorityQueueAgeThresholdSeconds:[\s\S]*?Default: 300[\s\S]*?MinValue: 60[\s\S]*?MaxValue: 86400/);
});

test("dispatcher failure queue is monitored independently of lane DLQs", async () => {
  const template = await source();
  const alarm = resourceBlock(template, "DispatchFailureAlarm", "StandardBacklogAlarm");
  assert.match(alarm, /MetricName: ApproximateNumberOfMessagesVisible/);
  assert.match(alarm, /Value: !GetAtt DispatchFailureQueue.QueueName/);
  assert.match(alarm, /Threshold: 0/);
  assert.match(alarm, /EvaluationPeriods: 1/);
  assert.match(alarm, /AlarmActions: !If \[AlertsConfigured, \[!Ref OperationsAlarmTopicArn\]/);
});
