import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { parseCloudWorkspace } from "./studio-schema/workspace-schema.js";
import { ApiAccessError } from "./service.js";

// One bounded JSON snapshot per account. Keeping the payload as a string avoids
// DynamoDB nesting limits and makes the size budget independent of user keys.
export const MAX_WORKSPACE_BYTES = 256 * 1024;
const invalid = () => new ApiAccessError(400, "invalid_workspace", "Studio workspace is invalid.");
export function validateWorkspace(value) {
  const payload = JSON.stringify(value);
  if (typeof payload !== "string") throw invalid();
  if (Buffer.byteLength(payload) > MAX_WORKSPACE_BYTES) throw new ApiAccessError(413, "workspace_too_large", "Account workspace exceeds 256 KiB. Export older projects and history before saving.");
  try { return JSON.stringify(parseCloudWorkspace(value)); }
  catch { throw invalid(); }
}
export function createStudioWorkspaceStore(client, tableName) {
  if (!client || !tableName) throw new Error("Studio workspace storage is required.");
  const key = (accountId) => {
    if (typeof accountId !== "string" || !accountId || accountId.length > 200) throw invalid();
    return { authKey: `studio-workspace#${accountId}` };
  };
  return {
    async read(accountId) {
      const { Item } = await client.send(new GetCommand({ TableName: tableName, Key: key(accountId), ConsistentRead: true }));
      if (!Item) return { revision: 0, workspace: { schemaVersion: 1, projects: [] }, updatedAt: null };
      if (Item.kind !== "studio-workspace" || Item.accountId !== accountId) throw new Error("Invalid stored workspace identity.");
      return { revision: Item.revision, workspace: JSON.parse(Item.payload), updatedAt: Item.updatedAt };
    },
    async write(accountId, expectedRevision, workspace) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw invalid();
      const payload = validateWorkspace(workspace);
      const revision = expectedRevision + 1, updatedAt = new Date().toISOString();
      try {
        await client.send(new PutCommand({ TableName: tableName,
          Item: { ...key(accountId), kind: "studio-workspace", accountId, revision, updatedAt, payload },
          ConditionExpression: expectedRevision === 0 ? "attribute_not_exists(authKey)" : "#revision = :expected AND accountId = :account",
          ...(expectedRevision === 0 ? {} : { ExpressionAttributeNames: { "#revision": "revision" }, ExpressionAttributeValues: { ":expected": expectedRevision, ":account": accountId } }),
        }));
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") throw new ApiAccessError(409, "workspace_conflict", "Another device changed this workspace. Load the account copy before saving again.");
        throw error;
      }
      return { revision, updatedAt };
    },
  };
}
export function createStudioWorkspaceHandler({ enabled, customerAuth, store, siteOrigin }) {
  const response = (statusCode, body) => ({ statusCode, headers: {
    "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": siteOrigin,
    "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-solvelang-csrf", "x-content-type-options": "nosniff", vary: "Origin",
  }, body: JSON.stringify(body) });
  return async (event) => {
    try {
      const method = event?.requestContext?.http?.method;
      const headers = Object.fromEntries(Object.entries(event?.headers ?? {}).map(([k,v]) => [k.toLowerCase(),v]));
      if (headers.origin && headers.origin !== siteOrigin) throw new ApiAccessError(403, "invalid_origin", "Request origin is not allowed.");
      if (method === "OPTIONS") return response(204, {});
      if (!enabled || !customerAuth || !store) throw new ApiAccessError(503, "studio_unavailable", "Account saving is not available yet. Local saving still works.");
      if (method !== "GET" && method !== "POST") return response(405, { error: "Method not allowed." });
      const session = await customerAuth.authenticate(headers.cookie ?? event?.cookies?.join("; "));
      if (method === "GET") return response(200, { accountId: session.accountId, csrfToken: session.csrfToken, ...await store.read(session.accountId) });
      customerAuth.assertCsrf(session, headers["x-solvelang-csrf"]);
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
      if (Buffer.byteLength(raw) > MAX_WORKSPACE_BYTES + 2048) throw new ApiAccessError(413, "workspace_too_large", "Account workspace exceeds 256 KiB.");
      const body = JSON.parse(raw);
      // Prevent a tab belonging to account A from writing after another tab signs in as B.
      if (!body || body.accountId !== session.accountId) throw new ApiAccessError(409, "account_changed", "Your signed-in account changed. Reconnect before saving.");
      return response(200, { accountId: session.accountId, ...await store.write(session.accountId, body.expectedRevision, body.workspace) });
    } catch (error) {
      if (error instanceof ApiAccessError) return response(error.statusCode, { error: error.publicMessage, code: error.code });
      if (error instanceof SyntaxError) return response(400, { error: "Invalid workspace JSON.", code: "invalid_workspace" });
      // Do not log user workflows, cookies, or storage exception material.
      return response(500, { error: "Account saving failed. Your local work is preserved.", code: "studio_save_failed" });
    }
  };
}
