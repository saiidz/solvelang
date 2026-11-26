import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const handlerSource = await readFile(new URL("../src/handler.js", import.meta.url), "utf8");
const apiHandlerSource = await readFile(new URL("../src/api-handler.js", import.meta.url), "utf8");
const moduleSource = await readFile(new URL("../src/platform-connections.js", import.meta.url), "utf8");

test("the handler constructs the platform connections service from the auth table and hands it over", () => {
  assert.ok(handlerSource.includes('import { createPlatformConnectionsService } from "./platform-connections.js";'));
  assert.ok(handlerSource.includes('import { createDynamoPlatformConnectionsStore } from "./platform-connections-store.js";'));
  assert.ok(handlerSource.includes('import { createPlatformTokenProtector } from "./platform-token-protector.js";'));
  assert.ok(handlerSource.includes("createDynamoPlatformConnectionsStore(documentClient, environment.customerAuthTable)"));
  assert.ok(handlerSource.includes("process.env.API_PLATFORM_TOKENS_KMS_KEY_ARN"));
  assert.ok(handlerSource.includes("platformConnections,"));
});

test("the API handler routes the three platform-connection paths behind the session, failing closed when unconstructed", () => {
  assert.ok(apiHandlerSource.includes("platformConnections = null,"));
  assert.ok(apiHandlerSource.includes('path.endsWith("/customer/platform-connections")'));
  assert.ok(apiHandlerSource.includes('path.endsWith("/customer/platform-connections/audit")'));
  assert.ok(apiHandlerSource.includes('"platform_connections_not_configured"'));
  assert.ok(apiHandlerSource.includes("platformConnections.register(session.accountId, parseJson(event))"));
  assert.ok(apiHandlerSource.includes("platformConnections.list(session.accountId)"));
  assert.ok(apiHandlerSource.includes("platformConnections.audit(session.accountId, parseJson(event)?.connectionId)"));
});

test("the connections module keeps the honesty pins: awaiting status, no GitHub, no MGOV", () => {
  assert.ok(moduleSource.includes('"awaiting_configuration"'));
  assert.ok(moduleSource.includes("Connection saved — the first live audit for this platform is enabled when its access is configured."));
  assert.ok(moduleSource.includes('["gitlab", "azure", "bitbucket", "forge"]'));
  assert.ok(!moduleSource.includes("merge-governance"), "the module never reaches into the merge-governance service");
  assert.ok(!moduleSource.includes("github"), "GitHub connections are not this module's business");
});
