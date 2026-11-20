import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildWorkspaceContextPack, retrieveWorkspaceContext } from "../src/context-workspace.js";
import { createRemoteSolveLangHttpServer } from "../src/remote.js";
import {
  SOLVE_GRAPH_SCHEMA,
  canonicalSolveGraphJson,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "../src/solve-graph.js";

const TOKEN = "solvelang_remote_proof_token_0123456789abcdef";

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

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  return text as string;
}

// Real-client proof: an actual MCP SDK client connects over Streamable HTTP
// to the remote endpoint and completes a real task — "what is impacted if
// src/store.ts changes?" The two surfaces cooperate the way they are
// designed to: a locally built Solve Context pack selects and pins the
// task-relevant graph excerpts (content-hash provenance, hash-verified
// retrieval), the excerpts identify the changed node, and the caller then
// supplies its own graph JSON to the remote endpoint — the remote model
// never reads a workspace. Set SOLVELANG_REMOTE_PROOF_TRANSCRIPT to a file
// path to also persist the step-by-step transcript as evidence.
test("real MCP client completes an impact task driven by a context pack", async () => {
  const transcript: Array<{ step: string; detail: unknown }> = [];
  const record = (step: string, detail: unknown) => {
    transcript.push({ step, detail });
  };

  const workspace = await mkdtemp(path.join(tmpdir(), "solvelang-remote-proof-"));
  const previousRoot = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = workspace;
  const server = createRemoteSolveLangHttpServer({ bearerToken: TOKEN });
  try {
    const graph = graphFixture();
    const graphText = `${JSON.stringify(graph, null, 2)}\n`;
    await writeFile(path.join(workspace, "graph.json"), graphText, "utf8");
    const store = graph.nodes.find((item) => item.identity === "file:src/store.ts");
    const api = graph.nodes.find((item) => item.identity === "file:src/api.ts");
    const apiTest = graph.nodes.find((item) => item.kind === "test");
    assert.ok(store && api && apiTest);

    // Step 1: build a Solve Context pack locally for the task. The pack
    // pins the graph file by content hash and selects the excerpts that
    // are relevant to changing src/store.ts.
    const pack = await buildWorkspaceContextPack("Assess the impact of changing src/store.ts", {
      paths: ["graph.json"],
      budgetBytes: 200_000,
    });
    const graphEntries = pack.pack.entries
      .filter((item) => item.path === "graph.json")
      .sort((left, right) => left.startLine - right.startLine);
    assert.ok(graphEntries.length >= 1, "context pack must include graph.json excerpts");
    for (const entry of graphEntries) {
      assert.equal(entry.sourceSha256, createHash("sha256").update(graphText, "utf8").digest("hex"));
    }
    record("context_pack_built", {
      schema: pack.schema,
      graphExcerpts: graphEntries.map((item) => ({
        handle: item.handle,
        startLine: item.startLine,
        endLine: item.endLine,
        sourceSha256: item.sourceSha256,
        excerptSha256: item.excerptSha256,
      })),
    });

    // Step 2: retrieve the excerpts through their pack handles (each
    // retrieval is hash-checked by the context machinery) and let the
    // pack — not the test — identify the changed node's stable ID.
    const excerptTexts: string[] = [];
    for (const entry of graphEntries) {
      const retrieved = await retrieveWorkspaceContext({
        handle: entry.handle,
        path: entry.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
        sourceSha256: entry.sourceSha256,
        excerptSha256: entry.excerptSha256,
      });
      excerptTexts.push(retrieved.content);
    }
    const excerptText = excerptTexts.join("\n");
    const identified = excerptText.match(/"id": "(sgn_[a-f0-9]{32})"[^}]*?"identity": "file:src\/store\.ts"/s);
    assert.ok(identified, "pack excerpts must identify the src/store.ts node");
    const changedNodeId = identified[1];
    assert.equal(changedNodeId, store.id);
    record("pack_identified_changed_node", { changedNodeId, identity: "file:src/store.ts" });

    // Step 3: connect a real MCP client to the remote endpoint.
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "solvelang-remote-client-proof", version: "1.0.0" });
    await client.connect(transport);
    try {
      record("client_connected", { serverInfo: client.getServerVersion() ?? null });

      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [...REMOTE_TOOL_NAMES]);
      record("tools_listed", { tools: listed.tools.map((tool) => tool.name) });

      // Step 4: complete the task. The caller supplies its own graph JSON
      // (the exact bytes the pack pinned by hash) plus the pack-identified
      // node ID; the endpoint performs the analysis in memory.
      const impact = await client.callTool({
        name: "solvelang_graph_impact",
        arguments: { rawJson: graphText, changedNodeIds: [changedNodeId] },
      });
      const impactBody = JSON.parse(textOf(impact)) as {
        entries: Array<{ node: { id: string } }>;
      };
      assert.deepEqual(
        impactBody.entries.map((item) => item.node.id),
        [store.id, api.id, apiTest.id],
      );
      record("impact_call", {
        tool: "solvelang_graph_impact",
        changedNodeIds: [changedNodeId],
        impactedNodeIds: impactBody.entries.map((item) => item.node.id),
      });

      const explanation = await client.callTool({
        name: "solvelang_graph_explain_impact",
        arguments: { rawJson: graphText, changedNodeIds: [changedNodeId] },
      });
      const explanationText = textOf(explanation);
      assert.match(explanationText, /src\/api\.ts/);
      record("explain_impact_call", {
        tool: "solvelang_graph_explain_impact",
        resultExcerpt: explanationText.slice(0, 400),
      });
    } finally {
      await client.close();
    }

    if (process.env.SOLVELANG_REMOTE_PROOF_TRANSCRIPT) {
      await writeFile(
        process.env.SOLVELANG_REMOTE_PROOF_TRANSCRIPT,
        `${JSON.stringify(transcript, null, 2)}\n`,
        "utf8",
      );
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (previousRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previousRoot;
    await rm(workspace, { recursive: true, force: true });
  }
});
