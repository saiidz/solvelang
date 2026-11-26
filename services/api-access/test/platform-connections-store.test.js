import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoPlatformConnectionsStore } from "../src/platform-connections-store.js";

const ACCOUNT = `acct_${"a".repeat(32)}`;
const TABLE = "customer-auth-test";

function fakeDocumentClient(scanPages = []) {
  const sent = [];
  let page = 0;
  return {
    sent,
    async send(command) {
      sent.push(command);
      if (command.input.Item) return {};
      const result = scanPages[page] ?? { Items: [] };
      page += 1;
      return result;
    },
  };
}

test("the store requires a document client and a table", () => {
  assert.throws(() => createDynamoPlatformConnectionsStore(null, TABLE));
  assert.throws(() => createDynamoPlatformConnectionsStore({ send: async () => ({}) }, ""));
});

test("addConnection writes one auth-table item under the account's platform prefix", async () => {
  const client = fakeDocumentClient();
  const store = createDynamoPlatformConnectionsStore(client, TABLE);
  await store.addConnection(ACCOUNT, {
    connectionId: "conn-1",
    platform: "gitlab",
    baseUrl: "https://gitlab.example.com",
    repositories: ["group/project"],
    tokenCiphertext: "sealed",
    tokenFingerprint: "0123456789ab",
    createdAt: "2026-11-26T20:00:00.000Z",
    updatedAt: "2026-11-26T20:00:00.000Z",
  });
  assert.equal(client.sent.length, 1);
  const { TableName, Item } = client.sent[0].input;
  assert.equal(TableName, TABLE);
  assert.equal(Item.authKey, `platform-connection#${ACCOUNT}#conn-1`);
  assert.equal(Item.kind, "platform-connection");
  assert.equal(Item.accountId, ACCOUNT);
  assert.equal(Item.platform, "gitlab");
});

test("listConnections scans by prefix, keeps only connection records, and sorts by creation", async () => {
  const older = {
    authKey: `platform-connection#${ACCOUNT}#conn-2`,
    kind: "platform-connection",
    connectionId: "conn-2",
    platform: "forge",
    repositories: ["acme/alpha"],
    createdAt: "2026-11-26T19:00:00.000Z",
  };
  const newer = {
    authKey: `platform-connection#${ACCOUNT}#conn-1`,
    kind: "platform-connection",
    connectionId: "conn-1",
    platform: "gitlab",
    repositories: ["group/project"],
    createdAt: "2026-11-26T20:00:00.000Z",
  };
  const foreign = {
    authKey: `platform-connection#${ACCOUNT}#conn-9`,
    kind: "something-else",
    connectionId: "conn-9",
  };
  const client = fakeDocumentClient([
    { Items: [newer, foreign], LastEvaluatedKey: { authKey: "page-2" } },
    { Items: [older] },
  ]);
  const store = createDynamoPlatformConnectionsStore(client, TABLE);
  const connections = await store.listConnections(ACCOUNT);
  assert.deepEqual(connections.map((item) => item.connectionId), ["conn-2", "conn-1"]);
  assert.equal(client.sent.length, 2, "the scan follows pagination");
  const scan = client.sent[0].input;
  assert.equal(scan.FilterExpression, "begins_with(authKey, :prefix)");
  assert.equal(scan.ExpressionAttributeValues[":prefix"], `platform-connection#${ACCOUNT}#`);
  assert.deepEqual(client.sent[1].input.ExclusiveStartKey, { authKey: "page-2" });
});
