import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

function authVersionOf(value) {
  if (value === undefined) return 1;
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export function createDynamoAccountAccessStore(documentClient, { tableName }) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Customer auth table is required.");

  async function getRecord(authKey) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey },
      ConsistentRead: true,
    }));
    return response.Item;
  }

  async function getAccount(accountId) {
    const record = await getRecord(`account#${accountId}`);
    if (!record || record.kind !== "account") return undefined;
    if (record.accountId !== accountId) throw new Error("Customer account identity is invalid.");
    return record;
  }

  async function getRequest(requestFingerprint) {
    const record = await getRecord(`access-request#${requestFingerprint}`);
    return record?.kind === "access-request" ? record : undefined;
  }

  async function transitionAccess({
    account,
    previousState,
    targetState,
    reason,
    changedAt,
    changedBy,
    requestId,
    requestFingerprint,
  }) {
    const currentAuthVersion = authVersionOf(account.authVersion);
    if (!currentAuthVersion) throw new Error("Customer authentication version is invalid.");
    const nextAuthVersion = currentAuthVersion + 1;
    if (!Number.isSafeInteger(nextAuthVersion)) throw new Error("Customer authentication version overflowed.");

    const legacyAccessState = account.accessState === undefined;
    const legacyAuthVersion = account.authVersion === undefined;
    const accessCondition = legacyAccessState
      ? "attribute_not_exists(accessState)"
      : "accessState = :previousState";
    const versionCondition = legacyAuthVersion
      ? "attribute_not_exists(authVersion)"
      : "authVersion = :currentAuthVersion";
    const expressionAttributeValues = {
      ":accountKind": "account",
      ":targetState": targetState,
      ":reason": reason,
      ":changedAt": changedAt,
      ":changedBy": changedBy,
      ":nextAuthVersion": nextAuthVersion,
      ...(legacyAccessState ? {} : { ":previousState": previousState }),
      ...(legacyAuthVersion ? {} : { ":currentAuthVersion": currentAuthVersion }),
    };

    try {
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                authKey: `access-request#${requestFingerprint}`,
                kind: "access-request",
                accountId: account.accountId,
                requestId,
                previousState,
                targetState,
                reason,
                changedAt,
                changedBy,
                resultingAuthVersion: nextAuthVersion,
              },
              ConditionExpression: "attribute_not_exists(authKey)",
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { authKey: `account#${account.accountId}` },
              UpdateExpression: "SET accessState = :targetState, accessReason = :reason, accessChangedAt = :changedAt, accessChangedBy = :changedBy, updatedAt = :changedAt, authVersion = :nextAuthVersion",
              ConditionExpression: `kind = :accountKind AND ${accessCondition} AND ${versionCondition}`,
              ExpressionAttributeValues: expressionAttributeValues,
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                authKey: `access-audit#${account.accountId}#${changedAt}#${requestFingerprint.slice(0, 16)}`,
                kind: "access-audit",
                accountId: account.accountId,
                previousState,
                targetState,
                reason,
                changedAt,
                changedBy,
                requestId,
                resultingAuthVersion: nextAuthVersion,
              },
              ConditionExpression: "attribute_not_exists(authKey)",
            },
          },
        ],
      }));
      return "updated";
    } catch (error) {
      if (error?.name === "TransactionCanceledException") return "conflict";
      throw error;
    }
  }

  return { getRecord, getAccount, getRequest, transitionAccess };
}
