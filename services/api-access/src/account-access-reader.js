import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { accountIsActive, accountAccessState } from "./account-access.js";

export function createDynamoAccountAccessReader(documentClient, { tableName }) {
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

  async function isActive(accountId) {
    return accountIsActive(await getAccount(accountId));
  }

  async function getState(accountId) {
    return accountAccessState(await getAccount(accountId));
  }

  return { getRecord, getAccount, isActive, getState };
}
