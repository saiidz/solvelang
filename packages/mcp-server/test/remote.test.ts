import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  REMOTE_MCP_RATE_LIMIT,
  createRemoteRateLimiter,
  createRemoteSolveLangHttpServer,
  normalizeOpenAiAppsChallengeToken,
  normalizeRemoteAuthMode,
  normalizeRemoteBearerToken,
  normalizeRemoteRateLimit,
  normalizeRemoteTestToken,
  remoteBearerHeaderMatches,
} from "../src/remote.js";
import {
  SOLVE_GRAPH_SCHEMA,
  canonicalSolveGraphJson,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "../src/solve-graph.js";

const TOKEN = "solvelang_remote_test_token_0123456789abcdef";
const TEST_TOKEN = "solvelang_remote_healthcheck_token_0123456789abcdef";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createRemoteSolveLangHttpServer({ bearerToken: TOKEN });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function withPublicServer(run: (baseUrl: string) => Promise<void>, challengeToken?: string) {
  const server = createRemoteSolveLangHttpServer({ authMode: "noauth", openaiChallengeToken: challengeToken });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("remote auth mode and OpenAI challenge token validation fail closed", () => {
  assert.equal(normalizeRemoteAuthMode(undefined), "bearer");
  assert.equal(normalizeRemoteAuthMode(" NOAUTH "), "noauth");
  assert.throws(() => normalizeRemoteAuthMode("public"), /bearer or noauth/);
  assert.equal(normalizeOpenAiAppsChallengeToken(undefined), undefined);
  assert.equal(normalizeOpenAiAppsChallengeToken(" challenge-token "), "challenge-token");
  assert.throws(() => normalizeOpenAiAppsChallengeToken("bad\nvalue"), /control characters/);
});

test("public remote mode exposes exact OpenAI domain challenge and accepts anonymous MCP ingress", async () => {
  const challengeToken = "openai-apps-challenge-test-token";
  await withPublicServer(async (baseUrl) => {
    const challenge = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), challengeToken);
    assert.match(challenge.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(challenge.headers.get("cache-control"), "no-store");

    const anonymousWrongType = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(anonymousWrongType.status, 415);
  }, challengeToken);
});

test("remote bearer token validation is bounded and constant-time compatible", () => {
  assert.equal(normalizeRemoteBearerToken(`  ${TOKEN}  `), TOKEN);
  assert.throws(() => normalizeRemoteBearerToken("short"), /32-1024/);
  assert.throws(() => normalizeRemoteBearerToken(`${TOKEN} with-space`), /whitespace/);
  assert.equal(remoteBearerHeaderMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(remoteBearerHeaderMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(remoteBearerHeaderMatches("Basic abc", TOKEN), false);
  assert.equal(remoteBearerHeaderMatches(undefined, TOKEN), false);
});

test("remote HTTP boundary exposes only health and authenticated POST MCP ingress", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "solvelang-mcp", mode: "remote-read-only" });
    assert.equal(health.headers.get("cache-control"), "no-store");

    const missing = await fetch(`${baseUrl}/missing`);
    assert.equal(missing.status, 404);

    const wrongMethod = await fetch(`${baseUrl}/mcp`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const wrongToken = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer wrong_wrong_wrong_wrong_wrong_wrong", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(wrongToken.status, 401);

    const wrongType = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(wrongType.status, 415);

    const badJson = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(badJson.status, 400);
  });
});

test("remote HTTP boundary rejects oversized requests before MCP parsing", async () => {
  await withServer(async (baseUrl) => {
    const oversized = "x".repeat(4 * 1024 * 1024 + 1);
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: oversized,
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  });
});

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex");
}

function graphNode(kind: SolveGraphNodeKind, identity: string, label: string, path: string): SolveGraphNode {
  return {
    id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, identity }).slice(0, 32)}`,
    kind,
    identity,
    label,
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path },
  };
}

function graphEdge(kind: SolveGraphEdgeKind, from: string, to: string, path: string): SolveGraphEdge {
  return {
    id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, from, to, qualifier: "" }).slice(0, 32)}`,
    kind,
    from,
    to,
    evidence: [{ kind: "deterministic-analysis", path }],
  };
}

function graphFixture(): SolveGraphDocument {
  const repository = graphNode("repository", "repo:fixture", "Fixture repository", "README.md");
  const api = graphNode("file", "file:src/api.ts", "src/api.ts", "src/api.ts");
  const store = graphNode("file", "file:src/store.ts", "src/store.ts", "src/store.ts");
  const apiTest = graphNode("test", "test:test/api.test.ts", "test/api.test.ts", "test/api.test.ts");
  const nodes = [repository, api, store, apiTest].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [
    graphEdge("contains", repository.id, api.id, "src/api.ts"),
    graphEdge("contains", repository.id, store.id, "src/store.ts"),
    graphEdge("imports", api.id, store.id, "src/api.ts"),
    graphEdge("tests", apiTest.id, api.id, "test/api.test.ts"),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const source = {
    kind: "repository" as const,
    displayName: "fixture",
    fingerprint: `sha256:${"a".repeat(64)}`,
    revision: "test",
    private: true,
  };
  const extractors = [{ id: "fixture", version: "1", deterministic: true as const }];
  const limits = {
    maxFiles: 100,
    maxTotalBytes: 1_000_000,
    maxFileBytes: 100_000,
    maxDepth: 16,
    maxNodes: 1_000,
    maxEdges: 2_000,
    maxEvidencePerElement: 10,
    maxMetadataEntries: 10,
    maxMetadataStringBytes: 2_048,
    maxIdentityBytes: 2_048,
  };
  const graphId = `sg_${digest({
    schema: SOLVE_GRAPH_SCHEMA,
    sourceFingerprint: source.fingerprint,
    engineVersion: "0.1.0",
    extractors,
    limits,
  }).slice(0, 32)}`;
  const withoutIntegrity = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId,
    mode: "analyze-only" as const,
    engine: { name: "SolveLang Solve Graph", version: "0.1.0", deterministic: true as const },
    source,
    extractors,
    limits,
    execution: {
      status: "complete" as const,
      truncated: false,
      truncationReasons: [],
      networkAccess: false as const,
      writeAccess: false as const,
    },
    nodes,
    edges,
  };
  const integrityBase = { stableIds: true as const, ordering: "id-ascending" as const };
  return {
    ...withoutIntegrity,
    integrity: {
      canonicalJsonSha256: `sha256:${digest({ ...withoutIntegrity, integrity: integrityBase })}`,
      ...integrityBase,
    },
  };
}

async function withConfiguredServer(
  options: Parameters<typeof createRemoteSolveLangHttpServer>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createRemoteSolveLangHttpServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("remote rate limit normalization fails closed", () => {
  assert.deepEqual(normalizeRemoteRateLimit(undefined), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(REMOTE_MCP_RATE_LIMIT, { limit: 60, windowMs: 60_000 });
  assert.deepEqual(normalizeRemoteRateLimit({ limit: 5 }), { limit: 5, windowMs: 60_000 });
  assert.deepEqual(normalizeRemoteRateLimit({ limit: 0 }), { limit: 0, windowMs: 60_000 });
  assert.throws(() => normalizeRemoteRateLimit({ limit: -1 }), /0 through 100000/);
  assert.throws(() => normalizeRemoteRateLimit({ limit: 1.5 }), /0 through 100000/);
  assert.throws(() => normalizeRemoteRateLimit({ windowMs: 10 }), /100 through 3600000/);
});

test("remote rate limiter enforces a fixed window per source", () => {
  let at = 1_000_000;
  const limiter = createRemoteRateLimiter({ limit: 2, windowMs: 60_000 }, () => at);
  assert.equal(limiter.check("203.0.113.7").allowed, true);
  assert.equal(limiter.check("203.0.113.7").allowed, true);
  const blocked = limiter.check("203.0.113.7");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  assert.equal(limiter.check("198.51.100.9").allowed, true);
  assert.equal(limiter.check(undefined).allowed, true);
  at += 60_000;
  assert.equal(limiter.check("203.0.113.7").allowed, true);
  const disabled = createRemoteRateLimiter({ limit: 0, windowMs: 60_000 }, () => at);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(disabled.check("203.0.113.7").allowed, true);
  }
});

test("remote HTTP boundary returns 429 with Retry-After once the rate limit is exhausted", async () => {
  await withConfiguredServer({ bearerToken: TOKEN, rateLimit: { limit: 3, windowMs: 60_000 } }, async (baseUrl) => {
    const post = () => fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    for (let index = 0; index < 3; index += 1) {
      const response = await post();
      assert.notEqual(response.status, 429);
      await response.text();
    }
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "rate_limited" });
    const retryAfter = Number(limited.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
  });
});

test("remote MCP protocol round-trip over real HTTP: initialize, tools/list, tools/call", async () => {
  await withServer(async (baseUrl) => {
    const rpc = async (body: unknown) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };

    const initialize = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "remote-protocol-test", version: "1.0.0" },
      },
    });
    assert.equal(initialize.status, 200);
    assert.equal(initialize.json.result.serverInfo.name, "solvelang-remote");

    const initialized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(initialized.status, 202);

    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.result.tools.map((tool: { name: string }) => tool.name), [
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
    ]);

    const capabilities = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "solvelang_capabilities", arguments: {} },
    });
    assert.equal(capabilities.status, 200);
    const capabilitiesBody = JSON.parse(capabilities.json.result.content[0].text);
    assert.equal(capabilitiesBody.mode, "remote-read-only");
    assert.equal(capabilitiesBody.authentication, "bearer");
    assert.deepEqual(capabilitiesBody.limits.rateLimit, { maxRequestsPerWindow: 60, windowMs: 60_000 });

    const graph = graphFixture();
    const store = graph.nodes.find((item) => item.identity === "file:src/store.ts");
    assert.ok(store);
    const impact = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "solvelang_graph_impact",
        arguments: { rawJson: JSON.stringify(graph), changedNodeIds: [store.id] },
      },
    });
    assert.equal(impact.status, 200);
    const impactBody = JSON.parse(impact.json.result.content[0].text);
    const api = graph.nodes.find((item) => item.identity === "file:src/api.ts");
    const apiTest = graph.nodes.find((item) => item.kind === "test");
    assert.ok(api && apiTest);
    assert.deepEqual(
      impactBody.entries.map((entry: { node: { id: string } }) => entry.node.id),
      [store.id, api.id, apiTest.id],
    );
  });
});

test("remote test token normalization is optional and bounded like the primary token", () => {
  assert.equal(normalizeRemoteTestToken(undefined), undefined);
  assert.equal(normalizeRemoteTestToken(""), undefined);
  assert.equal(normalizeRemoteTestToken("   "), undefined);
  assert.equal(normalizeRemoteTestToken(`  ${TEST_TOKEN}  `), TEST_TOKEN);
  assert.throws(() => normalizeRemoteTestToken("short"), /32-1024/);
  assert.throws(() => normalizeRemoteTestToken(`${TEST_TOKEN} with-space`), /whitespace/);
});

test("remote HTTP boundary accepts the optional test token and fails closed without it", async () => {
  // A 415 answer proves authentication passed and the content-type
  // boundary answered; a 401 proves authentication refused the request.
  const probe = async (baseUrl: string, authorization: string | undefined) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "content-type": "text/plain",
      },
      body: "{}",
    });
    return response.status;
  };
  await withConfiguredServer({ bearerToken: TOKEN, testToken: TEST_TOKEN }, async (baseUrl) => {
    assert.equal(await probe(baseUrl, `Bearer ${TOKEN}`), 415);
    assert.equal(await probe(baseUrl, `Bearer ${TEST_TOKEN}`), 415);
    assert.equal(await probe(baseUrl, undefined), 401);
    assert.equal(await probe(baseUrl, "Bearer <redacted>"), 401);
  });
  await withConfiguredServer({ bearerToken: TOKEN }, async (baseUrl) => {
    assert.equal(await probe(baseUrl, `Bearer ${TOKEN}`), 415);
    assert.equal(await probe(baseUrl, `Bearer ${TEST_TOKEN}`), 401);
  });
});
