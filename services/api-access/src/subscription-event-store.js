import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

function requiredText(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
  return value;
}

function requiredTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

export function createDynamoSubscriptionEventStore(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Subscription events table is required.");

  async function getEvent(eventId) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { eventId },
      ConsistentRead: true,
    }));
    return response.Item;
  }

  function matchingLegacyEvent(existing, record) {
    return Boolean(
      existing
      && existing.payloadFingerprint === undefined
      && existing.processingStatus === undefined
      && existing.eventId === record.eventId
      && existing.eventType === record.eventType
      && existing.subscriptionId === record.subscriptionId
      && existing.accountId === record.accountId
      && existing.createdAt === record.createdAt,
    );
  }

  function classifyExisting(existing, record, now) {
    if (matchingLegacyEvent(existing, record)) return "duplicate";
    if (!existing || existing.payloadFingerprint !== record.payloadFingerprint) return "conflict";
    if (existing.processingStatus === "completed") return "duplicate";
    if (existing.processingStatus === "retryable") return "retryable";
    if (existing.processingStatus !== "processing") return "conflict";
    if (!Number.isSafeInteger(existing.processingLeaseUntil)) return "conflict";
    return existing.processingLeaseUntil <= now ? "expired" : "busy";
  }

  async function reclaim(record, claim, expectedStatus) {
    try {
      await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { eventId: record.eventId },
        UpdateExpression: "SET processingStatus = :processing, claimToken = :claimToken, processingLeaseUntil = :leaseUntil, claimedAt = :claimedAt, expiresAt = :expiresAt REMOVE releasedAt",
        ConditionExpression: expectedStatus === "retryable"
          ? "processingStatus = :expectedStatus AND payloadFingerprint = :fingerprint"
          : "processingStatus = :expectedStatus AND payloadFingerprint = :fingerprint AND processingLeaseUntil <= :now",
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":expectedStatus": expectedStatus === "retryable" ? "retryable" : "processing",
          ":fingerprint": record.payloadFingerprint,
          ":claimToken": claim.claimToken,
          ":leaseUntil": claim.leaseUntil,
          ":claimedAt": claim.claimedAt,
          ":expiresAt": record.expiresAt,
          ...(expectedStatus === "retryable" ? {} : { ":now": claim.now }),
        },
      }));
      return "claimed";
    } catch (error) {
      if (error?.name !== "ConditionalCheckFailedException") throw error;
      return undefined;
    }
  }

  return {
    async claimEvent(record, claim) {
      requiredText(record?.eventId, "Stripe event ID");
      requiredText(record?.payloadFingerprint, "Stripe event payload fingerprint");
      requiredText(claim?.claimToken, "Stripe event claim token");
      requiredText(claim?.claimedAt, "Stripe event claimed timestamp");
      requiredTimestamp(claim?.now, "Stripe event claim time");
      requiredTimestamp(claim?.leaseUntil, "Stripe event lease");
      if (claim.leaseUntil <= claim.now) throw new Error("Stripe event lease must end after its claim time.");

      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            ...record,
            processingStatus: "processing",
            claimToken: claim.claimToken,
            processingLeaseUntil: claim.leaseUntil,
            claimedAt: claim.claimedAt,
          },
          ConditionExpression: "attribute_not_exists(eventId)",
        }));
        return "claimed";
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
      }

      let existing = await getEvent(record.eventId);
      let state = classifyExisting(existing, record, claim.now);
      if (state === "duplicate" || state === "busy" || state === "conflict") return state;

      const reclaimed = await reclaim(record, claim, state === "retryable" ? "retryable" : "processing");
      if (reclaimed) return reclaimed;

      existing = await getEvent(record.eventId);
      state = classifyExisting(existing, record, claim.now);
      if (state === "duplicate" || state === "conflict") return state;
      return "busy";
    },

    async completeEvent({ eventId, payloadFingerprint, claimToken, completedAt }) {
      requiredText(eventId, "Stripe event ID");
      requiredText(payloadFingerprint, "Stripe event payload fingerprint");
      requiredText(claimToken, "Stripe event claim token");
      requiredText(completedAt, "Stripe event completion timestamp");
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { eventId },
          UpdateExpression: "SET processingStatus = :completed, completedAt = :completedAt REMOVE claimToken, processingLeaseUntil, releasedAt",
          ConditionExpression: "processingStatus = :processing AND payloadFingerprint = :fingerprint AND claimToken = :claimToken",
          ExpressionAttributeValues: {
            ":completed": "completed",
            ":processing": "processing",
            ":fingerprint": payloadFingerprint,
            ":claimToken": claimToken,
            ":completedAt": completedAt,
          },
        }));
        return "completed";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "lost";
        throw error;
      }
    },

    async releaseEvent({ eventId, payloadFingerprint, claimToken, releasedAt }) {
      requiredText(eventId, "Stripe event ID");
      requiredText(payloadFingerprint, "Stripe event payload fingerprint");
      requiredText(claimToken, "Stripe event claim token");
      requiredText(releasedAt, "Stripe event release timestamp");
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { eventId },
          UpdateExpression: "SET processingStatus = :retryable, releasedAt = :releasedAt REMOVE claimToken, processingLeaseUntil",
          ConditionExpression: "processingStatus = :processing AND payloadFingerprint = :fingerprint AND claimToken = :claimToken",
          ExpressionAttributeValues: {
            ":retryable": "retryable",
            ":processing": "processing",
            ":fingerprint": payloadFingerprint,
            ":claimToken": claimToken,
            ":releasedAt": releasedAt,
          },
        }));
        return "released";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "lost";
        throw error;
      }
    },

    async getEvent(eventId) {
      return getEvent(requiredText(eventId, "Stripe event ID"));
    },

    async putEventIfAbsent(record) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(eventId)",
        }));
        return "created";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "duplicate";
        throw error;
      }
    },
  };
}
