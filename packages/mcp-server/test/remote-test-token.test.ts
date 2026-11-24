import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  REMOTE_MCP_TEST_TOKEN_ENV,
  createRemoteSolveLangHttpServer,
  normalizeRemoteTestToken,
  startRemoteSolveLangServer,
} from "../src/remote.js";
import type { Server as HttpServer } from "node:http";

const MASTER_TOKEN = "solvelang_remote_qa_master_token_0123456789abcdef";
const TEST_TOKEN = "solvelang_remote_qa_healthcheck_token_0123456789";

const REMOTE_TOOL_NAMES = [
  "solvelang_analyze_n8n",
  "solvelang_generate_n8n_report",
  "solvelang_graph_find_nodes",
  "solvelang_graph_search_nodes",
  "solvelang_graph_dependencies",
  "solvelang_graph_dependents",
  "solvelang_graph_shortest_path",
  "solvelang_graph_impact",
  "solvelang_graph_explain_impact",
  "solvelang_capabilities",
] as const;

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function startedBaseUrl(server: HttpServer): string {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function initialize(baseUrl: string, token: string | undefined) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "remote-test-token-qa", version: "1.0.0" },
      },
    }),
  });
  const body = response.status === 200 ? await response.json() : undefined;
  return { status: response.status, serverName: body?.result?.serverInfo?.name as string | undefined };
}

async function listToolNames(baseUrl: string, token: string): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "remote-test-token-qa", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

test("QA pin: the test token is configured through MCP_REMOTE_TEST_TOKEN and fails closed", () => {
  assert.equal(REMOTE_MCP_TEST_TOKEN_ENV, "MCP_REMOTE_TEST_TOKEN");
  assert.equal(normalizeRemoteTestToken(undefined), undefined);
  assert.equal(normalizeRemoteTestToken(""), undefined);
  assert.equal(normalizeRemoteTestToken("   "), undefined);
  assert.equal(normalizeRemoteTestToken(TEST_TOKEN), TEST_TOKEN);
  assert.throws(() => normalizeRemoteTestToken("too-short"), /32-1024/);
});

test("QA pin: accept matrix over a real MCP handshake", async () => {
  const server = createRemoteSolveLangHttpServer({ bearerToken: MASTER_TOKEN, testToken: TEST_TOKEN });
  const baseUrl = await listen(server);
  try {
    const master = await initialize(baseUrl, MASTER_TOKEN);
    assert.equal(master.status, 200);
    assert.equal(master.serverName, "solvelang-remote");

    const testToken = await initialize(baseUrl, TEST_TOKEN);
    assert.equal(testToken.status, 200);
    assert.equal(testToken.serverName, "solvelang-remote");

    assert.deepEqual(await listToolNames(baseUrl, MASTER_TOKEN), [...REMOTE_TOOL_NAMES]);
    assert.deepEqual(await listToolNames(baseUrl, TEST_TOKEN), [...REMOTE_TOOL_NAMES]);

    assert.equal((await initialize(baseUrl, undefined)).status, 401);
    assert.equal((await initialize(baseUrl, "solvelang_remote_qa_wrong_token_0123456789abcdef")).status, 401);
  } finally {
    await close(server);
  }
});

test("QA pin: env-configured test token works through the starter and revokes by unsetting", async () => {
  const previous = process.env[REMOTE_MCP_TEST_TOKEN_ENV];
  try {
    process.env[REMOTE_MCP_TEST_TOKEN_ENV] = TEST_TOKEN;
    const configured = await startRemoteSolveLangServer({ bearerToken: MASTER_TOKEN, authMode: "bearer", host: "127.0.0.1", port: 0 });
    const configuredUrl = startedBaseUrl(configured);
    try {
      assert.equal((await initialize(configuredUrl, TEST_TOKEN)).status, 200);
      assert.equal((await initialize(configuredUrl, MASTER_TOKEN)).status, 200);
    } finally {
      await close(configured);
    }

    delete process.env[REMOTE_MCP_TEST_TOKEN_ENV];
    const revoked = await startRemoteSolveLangServer({ bearerToken: MASTER_TOKEN, authMode: "bearer", host: "127.0.0.1", port: 0 });
    const revokedUrl = startedBaseUrl(revoked);
    try {
      assert.equal((await initialize(revokedUrl, TEST_TOKEN)).status, 401);
      assert.equal((await initialize(revokedUrl, MASTER_TOKEN)).status, 200);
    } finally {
      await close(revoked);
    }
  } finally {
    if (previous === undefined) delete process.env[REMOTE_MCP_TEST_TOKEN_ENV];
    else process.env[REMOTE_MCP_TEST_TOKEN_ENV] = previous;
  }
});
