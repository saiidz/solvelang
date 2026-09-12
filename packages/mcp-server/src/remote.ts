import { timingSafeEqual } from "node:crypto";
import { createServer as createNodeHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { analyzeN8nText, MAX_N8N_BYTES, MAX_N8N_NODES } from "./n8n.js";
import { explainSolveGraphImpact } from "./solve-graph-impact-explanation.js";
import { searchSolveGraphNodesRanked } from "./solve-graph-ranked-search.js";
import { findSolveGraphShortestPath } from "./solve-graph-shortest-path.js";
import {
  MAX_SOLVE_GRAPH_BYTES,
  executeSolveGraphTool,
  parseSolveGraphText,
  solveGraphEdgeKinds,
  solveGraphNodeKinds,
} from "./solve-graph.js";

export const REMOTE_MCP_DEFAULT_PATH = "/mcp" as const;
export const REMOTE_MCP_HEALTH_PATH = "/healthz" as const;
export const REMOTE_MCP_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const REMOTE_MCP_MIN_TOKEN_BYTES = 32;
export const REMOTE_MCP_MAX_TOKEN_BYTES = 1024;

const remoteToolNames = Object.freeze([
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
] as const);

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function readBoundedRawN8n(rawJson: string): string {
  if (Buffer.byteLength(rawJson, "utf8") > MAX_N8N_BYTES) throw new Error("The workflow exceeds the 2 MB safety limit.");
  return rawJson;
}

function readBoundedRawSolveGraph(rawJson: string) {
  if (Buffer.byteLength(rawJson, "utf8") > MAX_SOLVE_GRAPH_BYTES) throw new Error("The Solve Graph exceeds the 2 MB safety limit.");
  return parseSolveGraphText(rawJson);
}

const remoteN8nInputSchema = z.object({
  rawJson: z.string().min(1).describe("Raw n8n workflow JSON processed only in memory"),
});

const remoteN8nReportInputSchema = z.object({
  rawJson: z.string().min(1).describe("Raw n8n workflow JSON processed only in memory"),
  format: z.enum(["markdown", "json"]).default("markdown"),
});

const remoteSolveGraphFindInputSchema = z.object({
  rawJson: z.string().min(1).describe("Raw canonical Solve Graph JSON processed only in memory"),
  kinds: z.array(z.enum(solveGraphNodeKinds)).max(solveGraphNodeKinds.length).optional(),
  text: z.string().min(1).max(2_048).optional(),
  evidencePath: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
});

const remoteSolveGraphRankedSearchInputSchema = z.object({
  rawJson: z.string().min(1),
  query: z.string().min(1).max(512),
  kinds: z.array(z.enum(solveGraphNodeKinds)).max(solveGraphNodeKinds.length).optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
});

const remoteSolveGraphTraversalInputSchema = z.object({
  rawJson: z.string().min(1),
  rootIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
});

const remoteSolveGraphImpactInputSchema = z.object({
  rawJson: z.string().min(1),
  changedNodeIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
});

const remoteSolveGraphImpactExplanationInputSchema = remoteSolveGraphImpactInputSchema.extend({
  maxRows: z.number().int().min(1).max(256).optional(),
});

const remoteSolveGraphShortestPathInputSchema = z.object({
  rawJson: z.string().min(1),
  sourceId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  targetId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  direction: z.enum(["dependencies", "dependents"]).optional(),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxVisited: z.number().int().min(1).max(10_000).optional(),
});

export function createRemoteSolveLangMcpServer(): McpServer {
  const server = new McpServer(
    { name: "solvelang-remote", version: "0.2.0" },
    {
      instructions: "Remote SolveLang is raw-JSON-only, deterministic, read-only analysis. It has no workspace path access, subprocess execution, repository mutation, credential inspection, or outbound provider access.",
    },
  );

  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    "solvelang_analyze_n8n",
    {
      title: "Analyze n8n workflow",
      description: "Analyze raw n8n workflow JSON in memory. Remote mode never accepts workspace paths and never executes the workflow.",
      inputSchema: remoteN8nInputSchema,
      annotations,
    },
    async ({ rawJson }) => textResult(analyzeN8nText(readBoundedRawN8n(rawJson))),
  );

  server.registerTool(
    "solvelang_generate_n8n_report",
    {
      title: "Generate n8n report",
      description: "Generate a deterministic Markdown or JSON preflight report from raw in-memory n8n JSON without writing files.",
      inputSchema: remoteN8nReportInputSchema,
      annotations,
    },
    async ({ rawJson, format }) => {
      const report = analyzeN8nText(readBoundedRawN8n(rawJson));
      if (format === "json") return textResult(report);
      const findings = report.findings.map((finding) => `## ${finding.severity.toUpperCase()} — ${finding.title}\n\n${finding.detail}\n\n**Evidence:** ${finding.evidence}\n\n**Recommendation:** ${finding.recommendation}${finding.nodes?.length ? `\n\n**Nodes:** ${finding.nodes.join(", ")}` : ""}`).join("\n\n");
      return textResult(`# SolveLang Workflow Preflight\n\n**Workflow:** ${report.workflowName}\n\n**Result:** ${report.pass ? "PASS" : "FAIL"}\n\n**Score:** ${report.score}/100\n\n**Nodes:** ${report.nodeCount}\n\n**Connections:** ${report.connectionCount}\n\n${findings}\n\n---\nDeterministic structural analysis only. The workflow was not executed.`);
    },
  );

  server.registerTool(
    "solvelang_graph_find_nodes",
    {
      title: "Find Solve Graph nodes",
      description: "Search raw canonical Solve Graph JSON by node kind, text, or evidence path.",
      inputSchema: remoteSolveGraphFindInputSchema,
      annotations,
    },
    async ({ rawJson, kinds, text, evidencePath, limit }) => textResult(executeSolveGraphTool(
      readBoundedRawSolveGraph(rawJson),
      { tool: "solve_graph.find_nodes", query: { kinds, text, evidencePath, limit } },
    )),
  );

  server.registerTool(
    "solvelang_graph_search_nodes",
    {
      title: "Rank Solve Graph node matches",
      description: "Rank bounded deterministic node matches in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphRankedSearchInputSchema,
      annotations,
    },
    async ({ rawJson, query, kinds, limit }) => textResult(searchSolveGraphNodesRanked(
      readBoundedRawSolveGraph(rawJson),
      query,
      { kinds, limit },
    )),
  );

  server.registerTool(
    "solvelang_graph_dependencies",
    {
      title: "Traverse Solve Graph dependencies",
      description: "Traverse outbound dependency edges from stable node IDs in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphTraversalInputSchema,
      annotations,
    },
    async ({ rawJson, rootIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
      readBoundedRawSolveGraph(rawJson),
      { tool: "solve_graph.dependencies", rootIds, options: { edgeKinds, maxDepth, maxResults } },
    )),
  );

  server.registerTool(
    "solvelang_graph_dependents",
    {
      title: "Traverse Solve Graph dependents",
      description: "Traverse inbound dependency edges from stable node IDs in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphTraversalInputSchema,
      annotations,
    },
    async ({ rawJson, rootIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
      readBoundedRawSolveGraph(rawJson),
      { tool: "solve_graph.dependents", rootIds, options: { edgeKinds, maxDepth, maxResults } },
    )),
  );

  server.registerTool(
    "solvelang_graph_shortest_path",
    {
      title: "Find shortest Solve Graph path",
      description: "Find one deterministic bounded dependency or dependent path in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphShortestPathInputSchema,
      annotations,
    },
    async ({ rawJson, sourceId, targetId, direction, edgeKinds, maxDepth, maxVisited }) => textResult(findSolveGraphShortestPath(
      readBoundedRawSolveGraph(rawJson),
      sourceId,
      targetId,
      { direction, edgeKinds, maxDepth, maxVisited },
    )),
  );

  server.registerTool(
    "solvelang_graph_impact",
    {
      title: "Analyze Solve Graph impact",
      description: "Compute bounded transitive dependent impact from stable changed node IDs in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphImpactInputSchema,
      annotations,
    },
    async ({ rawJson, changedNodeIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
      readBoundedRawSolveGraph(rawJson),
      { tool: "solve_graph.impact", changedNodeIds, options: { edgeKinds, maxDepth, maxResults } },
    )),
  );

  server.registerTool(
    "solvelang_graph_explain_impact",
    {
      title: "Explain Solve Graph impact",
      description: "Explain bounded dependent impact from stable changed node IDs in raw canonical Solve Graph JSON.",
      inputSchema: remoteSolveGraphImpactExplanationInputSchema,
      annotations,
    },
    async ({ rawJson, changedNodeIds, edgeKinds, maxDepth, maxResults, maxRows }) => textResult(explainSolveGraphImpact(
      readBoundedRawSolveGraph(rawJson),
      changedNodeIds,
      { edgeKinds, maxDepth, maxResults, maxRows },
    )),
  );

  server.registerTool(
    "solvelang_capabilities",
    {
      title: "List remote SolveLang capabilities",
      description: "Describe the remote read-only tool surface, privacy boundary, and limits.",
      inputSchema: z.object({}),
      annotations,
    },
    async () => textResult({
      mode: "remote-read-only",
      transport: "streamable-http",
      inputModes: ["raw JSON processed only in memory"],
      limits: {
        maxRequestBytes: REMOTE_MCP_MAX_REQUEST_BYTES,
        maxN8nBytes: MAX_N8N_BYTES,
        maxN8nNodes: MAX_N8N_NODES,
        maxSolveGraphBytes: MAX_SOLVE_GRAPH_BYTES,
      },
      tools: remoteToolNames,
      unavailableInRemoteMode: ["workspace path inputs", "solvelang_validate_solve", "local subprocess execution"],
      privacy: [
        "Bearer authentication is required before MCP request parsing",
        "No workflow execution",
        "No workspace or filesystem reads",
        "No subprocess execution",
        "No outbound network/provider calls from tools",
        "No credential-value inspection",
        "No file or repository writes",
        "Raw JSON is not intentionally logged or persisted by the application",
      ],
    }),
  );

  return server;
}

export function normalizeRemoteBearerToken(value: string): string {
  if (typeof value !== "string") throw new Error("Remote MCP bearer token must be a string.");
  const token = value.trim();
  const size = Buffer.byteLength(token, "utf8");
  if (size < REMOTE_MCP_MIN_TOKEN_BYTES || size > REMOTE_MCP_MAX_TOKEN_BYTES) {
    throw new Error(`Remote MCP bearer token must be ${REMOTE_MCP_MIN_TOKEN_BYTES}-${REMOTE_MCP_MAX_TOKEN_BYTES} UTF-8 bytes.`);
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(token)) throw new Error("Remote MCP bearer token must not contain whitespace or control characters.");
  return token;
}

export function remoteBearerHeaderMatches(header: string | undefined, expectedToken: string): boolean {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const expected = Buffer.from(expectedToken, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBoundedJsonRequest(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw Object.assign(new Error("MCP requests require application/json."), { statusCode: 415 });

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > REMOTE_MCP_MAX_REQUEST_BYTES) {
      throw Object.assign(new Error("MCP request exceeds the bounded request size."), { statusCode: 413 });
    }
    chunks.push(bytes);
  }
  if (total === 0) throw Object.assign(new Error("MCP request body is required."), { statusCode: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("MCP request body must be valid JSON."), { statusCode: 400 });
  }
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

export type RemoteHttpServerOptions = Readonly<{
  bearerToken: string;
  mcpPath?: string;
}>;

export function createRemoteSolveLangHttpServer(options: RemoteHttpServerOptions): HttpServer {
  const bearerToken = normalizeRemoteBearerToken(options.bearerToken);
  const mcpPath = options.mcpPath ?? REMOTE_MCP_DEFAULT_PATH;
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(mcpPath) || mcpPath.includes("?")) {
    throw new Error("Remote MCP path must be a safe absolute URL path.");
  }

  return createNodeHttpServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? "/", "http://solvelang.invalid").pathname;
      if (pathname === REMOTE_MCP_HEALTH_PATH && req.method === "GET") {
        sendJson(res, 200, { status: "ok", service: "solvelang-mcp", mode: "remote-read-only" });
        return;
      }
      if (pathname !== mcpPath) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
        return;
      }
      if (!remoteBearerHeaderMatches(req.headers.authorization, bearerToken)) {
        sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
        return;
      }

      let body: unknown;
      try {
        body = await readBoundedJsonRequest(req);
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : 400;
        sendJson(res, Number.isInteger(statusCode) ? statusCode : 400, { error: "invalid_request" });
        return;
      }

      const mcpServer = createRemoteSolveLangMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } finally {
        await transport.close().catch(() => undefined);
        await mcpServer.close().catch(() => undefined);
      }
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      else if (!res.writableEnded) res.end();
    });
  });
}

export type StartRemoteSolveLangServerOptions = Readonly<{
  bearerToken?: string;
  host?: string;
  port?: number;
  mcpPath?: string;
}>;

export async function startRemoteSolveLangServer(options: StartRemoteSolveLangServerOptions = {}): Promise<HttpServer> {
  const bearerToken = options.bearerToken ?? process.env.SOLVELANG_REMOTE_BEARER_TOKEN ?? "";
  const host = options.host ?? process.env.SOLVELANG_REMOTE_HOST ?? "127.0.0.1";
  const configuredPort = options.port ?? Number(process.env.PORT ?? process.env.SOLVELANG_REMOTE_PORT ?? "8787");
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
    throw new Error("Remote MCP port must be an integer from 0 through 65535.");
  }
  const mcpPath = options.mcpPath ?? process.env.SOLVELANG_REMOTE_PATH ?? REMOTE_MCP_DEFAULT_PATH;
  const server = createRemoteSolveLangHttpServer({ bearerToken, mcpPath });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(configuredPort, host);
  });
  return server;
}
