import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function required(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
  return value;
}

function conditional(error) {
  return error?.name === "ConditionalCheckFailedException";
}

export function createDynamoPriorityJobStore(documentClient, { jobsTable }) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  required(jobsTable, "Priority jobs table");

  return {
    async putJob(job) {
      try {
        await documentClient.send(new PutCommand({
          TableName: jobsTable,
          Item: job,
          ConditionExpression: "attribute_not_exists(jobId)",
        }));
        return "created";
      } catch (error) {
        if (conditional(error)) return "exists";
        throw error;
      }
    },

    async getJob(jobId) {
      const response = await documentClient.send(new GetCommand({
        TableName: jobsTable,
        Key: { jobId },
        ConsistentRead: true,
      }));
      return response.Item;
    },

    async markDispatched(jobId, queueMessageId, dispatchedAt) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: jobsTable,
          Key: { jobId },
          UpdateExpression: "SET #status = :dispatched, queueMessageId = :messageId, dispatchedAt = :dispatchedAt",
          ConditionExpression: "#status = :queued",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":queued": "queued",
            ":dispatched": "dispatched",
            ":messageId": queueMessageId,
            ":dispatchedAt": dispatchedAt,
          },
        }));
        return "updated";
      } catch (error) {
        if (conditional(error)) return "already_progressed";
        throw error;
      }
    },

    async claimJob(jobId, lane, workerId, startedAt) {
      try {
        const response = await documentClient.send(new UpdateCommand({
          TableName: jobsTable,
          Key: { jobId },
          UpdateExpression: "SET #status = :processing, workerId = :workerId, startedAt = if_not_exists(startedAt, :startedAt), attempts = if_not_exists(attempts, :zero) + :one",
          ConditionExpression: "priority = :lane AND #status IN (:queued, :dispatched)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":lane": lane,
            ":queued": "queued",
            ":dispatched": "dispatched",
            ":processing": "processing",
            ":workerId": workerId,
            ":startedAt": startedAt,
            ":zero": 0,
            ":one": 1,
          },
          ReturnValues: "ALL_NEW",
        }));
        return { status: "claimed", job: response.Attributes };
      } catch (error) {
        if (conditional(error)) return { status: "unavailable" };
        throw error;
      }
    },

    async releaseJob(jobId, workerId, errorCode, failedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: jobsTable,
        Key: { jobId },
        UpdateExpression: "SET #status = :dispatched, lastErrorCode = :errorCode, lastFailedAt = :failedAt REMOVE workerId",
        ConditionExpression: "#status = :processing AND workerId = :workerId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":dispatched": "dispatched",
          ":workerId": workerId,
          ":errorCode": errorCode,
          ":failedAt": failedAt,
        },
      }));
    },

    async failJob(jobId, workerId, errorCode, failedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: jobsTable,
        Key: { jobId },
        UpdateExpression: "SET #status = :failed, errorCode = :errorCode, failedAt = :failedAt REMOVE workerId",
        ConditionExpression: "#status = :processing AND workerId = :workerId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":failed": "failed",
          ":workerId": workerId,
          ":errorCode": errorCode,
          ":failedAt": failedAt,
        },
      }));
    },

    async completeJob(jobId, workerId, result, completedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: jobsTable,
        Key: { jobId },
        UpdateExpression: "SET #status = :complete, #result = :result, completedAt = :completedAt REMOVE workerId, lastErrorCode, lastFailedAt",
        ConditionExpression: "#status = :processing AND workerId = :workerId",
        ExpressionAttributeNames: { "#status": "status", "#result": "result" },
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":complete": "complete",
          ":workerId": workerId,
          ":result": result,
          ":completedAt": completedAt,
        },
      }));
    },
  };
}
