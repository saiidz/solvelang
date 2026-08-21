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

  async function readRecord(jobId) {
    const response = await documentClient.send(new GetCommand({
      TableName: jobsTable,
      Key: { jobId },
      ConsistentRead: true,
    }));
    return response.Item;
  }

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

    getJob: readRecord,

    async putRequestMarker(marker) {
      try {
        await documentClient.send(new PutCommand({
          TableName: jobsTable,
          Item: marker,
          ConditionExpression: "attribute_not_exists(jobId)",
        }));
        return "created";
      } catch (error) {
        if (conditional(error)) return "exists";
        throw error;
      }
    },

    getRequestMarker: readRecord,

    async markRequestJobReserved(markerId, requestFingerprint, targetJobId) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: jobsTable,
          Key: { jobId: markerId },
          UpdateExpression: "SET #state = :jobReserved, targetJobId = :targetJobId",
          ConditionExpression: "recordType = :requestRecord AND requestFingerprint = :requestFingerprint AND (#state = :reserved OR (#state = :jobReserved AND targetJobId = :targetJobId))",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":requestRecord": "customer_priority_request",
            ":requestFingerprint": requestFingerprint,
            ":reserved": "reserved",
            ":jobReserved": "job_reserved",
            ":targetJobId": targetJobId,
          },
        }));
        return "updated";
      } catch (error) {
        if (conditional(error)) return "conflict";
        throw error;
      }
    },

    async activatePendingJob(jobId, requestFingerprint, usageCommittedAt) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: jobsTable,
          Key: { jobId },
          UpdateExpression: "SET #status = :queued, usageCommittedAt = :usageCommittedAt",
          ConditionExpression: "#status = :pendingUsage AND requestFingerprint = :requestFingerprint",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":pendingUsage": "pending_usage",
            ":queued": "queued",
            ":requestFingerprint": requestFingerprint,
            ":usageCommittedAt": usageCommittedAt,
          },
        }));
        return "updated";
      } catch (error) {
        if (!conditional(error)) throw error;
        const job = await readRecord(jobId);
        if (job?.requestFingerprint === requestFingerprint && ["queued", "dispatched", "processing", "complete", "failed"].includes(job.status)) {
          return "already_progressed";
        }
        return "conflict";
      }
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

    async claimJob(jobId, lane, workerId, claimedAt, leaseExpiresAt) {
      try {
        const response = await documentClient.send(new UpdateCommand({
          TableName: jobsTable,
          Key: { jobId },
          UpdateExpression: "SET #status = :processing, workerId = :workerId, startedAt = if_not_exists(startedAt, :startedAt), leaseExpiresAt = :leaseExpiresAt, attempts = if_not_exists(attempts, :zero) + :one",
          ConditionExpression: "priority = :lane AND (#status IN (:queued, :dispatched) OR (#status = :processing AND (attribute_not_exists(leaseExpiresAt) OR leaseExpiresAt <= :claimedAt)))",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":lane": lane,
            ":queued": "queued",
            ":dispatched": "dispatched",
            ":processing": "processing",
            ":workerId": workerId,
            ":startedAt": new Date(claimedAt).toISOString(),
            ":claimedAt": claimedAt,
            ":leaseExpiresAt": leaseExpiresAt,
            ":zero": 0,
            ":one": 1,
          },
          ReturnValues: "ALL_NEW",
        }));
        return { status: "claimed", job: response.Attributes };
      } catch (error) {
        if (!conditional(error)) throw error;
        const job = await readRecord(jobId);
        if (!job || job.priority !== lane) return { status: "invalid" };
        if (job.status === "complete" || job.status === "failed") return { status: "terminal", job };
        if (job.status === "processing" && Number.isSafeInteger(job.leaseExpiresAt) && job.leaseExpiresAt > claimedAt) {
          return { status: "busy", job };
        }
        throw error;
      }
    },

    async renewLease(jobId, workerId, renewedAt, leaseExpiresAt) {
      await documentClient.send(new UpdateCommand({
        TableName: jobsTable,
        Key: { jobId },
        UpdateExpression: "SET leaseExpiresAt = :leaseExpiresAt, lastHeartbeatAt = :renewedAtIso",
        ConditionExpression: "#status = :processing AND workerId = :workerId AND leaseExpiresAt > :renewedAtEpochMs",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":workerId": workerId,
          ":renewedAtEpochMs": renewedAt,
          ":renewedAtIso": new Date(renewedAt).toISOString(),
          ":leaseExpiresAt": leaseExpiresAt,
        },
      }));
    },

    async releaseJob(jobId, workerId, errorCode, failedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: jobsTable,
        Key: { jobId },
        UpdateExpression: "SET #status = :dispatched, lastErrorCode = :errorCode, lastFailedAt = :failedAt REMOVE workerId, leaseExpiresAt, lastHeartbeatAt",
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
        UpdateExpression: "SET #status = :failed, errorCode = :errorCode, failedAt = :failedAt REMOVE workerId, leaseExpiresAt, lastHeartbeatAt",
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
        UpdateExpression: "SET #status = :complete, #result = :result, completedAt = :completedAt REMOVE workerId, leaseExpiresAt, lastHeartbeatAt, lastErrorCode, lastFailedAt",
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
