import { timingSafeEqual } from "node:crypto";
import { createServer as createNodeHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { analyzeN8nText, MAX_N8N_BYTES, MAX_N8N_NODES } from "./n8n.js";
import { explainSolveGraphImpact } from "./solve-graph-impact-explanation.js";
import { searchSolveGraphNodesRanked } from "./solve-graph-ranked-search.js";
import { findSolveGraphShortestPath } from "./solve-graph-shortest-path.js";
import { TeamError, TeamStore, memberView, teamStoreFromEnvironment, teamView } from "./team.js";
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
export const REMOTE_OPENAI_APPS_CHALLENGE_PATH = "/.well-known/openai-apps-challenge" as const;

export const REMOTE_MCP_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 60_000 });

export const REMOTE_MCP_TEST_TOKEN_ENV = "MCP_REMOTE_TEST_TOKEN" as const;

export type RemoteRateLimit = Readonly<{ limit: number; windowMs: number }>;

export function normalizeRemoteRateLimit(value: Partial<RemoteRateLimit> | undefined): RemoteRateLimit {
  const limit = value?.limit ?? REMOTE_MCP_RATE_LIMIT.limit;
  const windowMs = value?.windowMs ?? REMOTE_MCP_RATE_LIMIT.windowMs;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100_000) {
    throw new Error("Remote MCP rate limit must be an integer from 0 through 100000 requests per window (0 disables the limiter).");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 100 || windowMs > 3_600_000) {
    throw new Error("Remote MCP rate limit window must be an integer from 100 through 3600000 milliseconds.");
  }
  return { limit, windowMs };
}

// Fixed-window, per-source-address limiter, mirroring the agent talk-back
// doorway in-handler pattern (services/api-access/src/agent-talkback.js):
// the limit is enforced before authentication and before any MCP parsing,
// so floods and credential guessing are throttled at the same boundary.
// The key is the socket source address as seen by this process; behind a
// shared proxy that aggregates callers, so production deployments still
// need edge rate limiting as well (see docs/integrations/remote-mcp.md).
export function createRemoteRateLimiter(
  rateLimit: RemoteRateLimit,
  now: () => number = Date.now,
): Readonly<{ check: (source: string | undefined) => Readonly<{ allowed: boolean; retryAfterSeconds: number }> }> {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    check(source: string | undefined) {
      if (rateLimit.limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
      const key = typeof source === "string" && source.length > 0 ? source : "unknown";
      const at = now();
      const window = windows.get(key);
      if (!window || at - window.startedAt >= rateLimit.windowMs) {
        if (windows.size >= 4_096) {
          for (const [entryKey, entry] of windows) {
            if (at - entry.startedAt >= rateLimit.windowMs) windows.delete(entryKey);
          }
        }
        windows.set(key, { startedAt: at, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      window.count += 1;
      if (window.count <= rateLimit.limit) return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + rateLimit.windowMs - at) / 1_000)),
      };
    },
  };
}

export type RemoteAuthMode = "bearer" | "noauth";

export function normalizeRemoteAuthMode(value: string | undefined): RemoteAuthMode {
  const mode = (value ?? "bearer").trim().toLowerCase();
  if (mode === "bearer" || mode === "noauth") return mode;
  throw new Error("Remote MCP auth mode must be bearer or noauth.");
}

export function normalizeOpenAiAppsChallengeToken(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const token = value.trim();
  if (!token || Buffer.byteLength(token, "utf8") > 2_048 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error("OpenAI apps challenge token must be 1-2048 UTF-8 bytes without control characters.");
  }
  return token;
}

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

export function createRemoteSolveLangMcpServer(options: Readonly<{ authMode?: RemoteAuthMode; rateLimit?: RemoteRateLimit | null }> = {}): McpServer {
  const authMode = options.authMode ?? "bearer";
  const rateLimit: RemoteRateLimit | null = options.rateLimit === undefined ? { ...REMOTE_MCP_RATE_LIMIT } : options.rateLimit;
  const server = new McpServer(
    { name: "solvelang-remote", version: "0.3.0" },
    {
      instructions: "Remote SolveLang is raw-JSON-only, deterministic, read-only analysis. It has no workspace path access, subprocess execution, repository mutation, credential inspection, or outbound provider access.",
    },
  );

  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const security = authMode === "noauth" ? { securitySchemes: [{ type: "noauth" as const }] } : {};

  server.registerTool(
    "solvelang_analyze_n8n",
    {
      title: "Analyze n8n workflow",
      description: "Analyze raw n8n workflow JSON in memory. Remote mode never accepts workspace paths and never executes the workflow.",
      inputSchema: remoteN8nInputSchema,
      annotations,
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
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
      ...security,
    },
    async () => textResult({
      mode: "remote-read-only",
      transport: "streamable-http",
      inputModes: ["raw JSON processed only in memory"],
      limits: {
        maxRequestBytes: REMOTE_MCP_MAX_REQUEST_BYTES,
        rateLimit: rateLimit ? { maxRequestsPerWindow: rateLimit.limit, windowMs: rateLimit.windowMs } : null,
        maxN8nBytes: MAX_N8N_BYTES,
        maxN8nNodes: MAX_N8N_NODES,
        maxSolveGraphBytes: MAX_SOLVE_GRAPH_BYTES,
      },
      tools: remoteToolNames,
      unavailableInRemoteMode: ["workspace path inputs", "solvelang_validate_solve", "local subprocess execution"],
      authentication: authMode === "noauth" ? "anonymous" : "bearer",
      privacy: [
        authMode === "noauth"
          ? "Public plugin mode accepts anonymous requests; the built-in per-address rate limiter is enforced before MCP parsing, and production deployments must also enforce edge rate limits and abuse controls."
          : "Bearer authentication is required before MCP request parsing.",
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

// Optional second bearer token (for directory health checkers, e.g.
// Glama). It authenticates the exact same read-only surface as the
// primary token and is revocable independently: unset it and the server
// fails closed to the primary token only. An unset or empty value
// disables it; a non-empty value must satisfy the same bounds as the
// primary token.
export function normalizeRemoteTestToken(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return normalizeRemoteBearerToken(value);
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
  bearerToken?: string;
  testToken?: string;
  teamStore?: TeamStore;
  authMode?: RemoteAuthMode;
  mcpPath?: string;
  openaiChallengeToken?: string;
  rateLimit?: Partial<RemoteRateLimit> | false;
}>;

export function createRemoteSolveLangHttpServer(options: RemoteHttpServerOptions): HttpServer {
  const authMode = options.authMode ?? "bearer";
  const bearerToken = authMode === "bearer" ? normalizeRemoteBearerToken(options.bearerToken ?? "") : undefined;
  const testToken = authMode === "bearer" ? normalizeRemoteTestToken(options.testToken) : undefined;
  const openaiChallengeToken = normalizeOpenAiAppsChallengeToken(options.openaiChallengeToken);
  const rateLimit: RemoteRateLimit | null = options.rateLimit === false ? null : normalizeRemoteRateLimit(options.rateLimit);
  const rateLimiter = rateLimit ? createRemoteRateLimiter(rateLimit) : null;
  const mcpPath = options.mcpPath ?? REMOTE_MCP_DEFAULT_PATH;
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(mcpPath) || mcpPath.includes("?")) {
    throw new Error("Remote MCP path must be a safe absolute URL path.");
  }

  const teamStore = options.teamStore;

  function bearerValue(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    return typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  }

  function isSingleUser(req: IncomingMessage): boolean {
    return authMode === "bearer" && (
      remoteBearerHeaderMatches(req.headers.authorization, bearerToken!) ||
      (testToken !== undefined && remoteBearerHeaderMatches(req.headers.authorization, testToken))
    );
  }

  async function readTeamJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw Object.assign(new Error("Team requests require application/json."), { statusCode: 415 });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > REMOTE_MCP_MAX_REQUEST_BYTES) throw Object.assign(new Error("Team request exceeds the bounded request size."), { statusCode: 413 });
      chunks.push(bytes);
    }
    if (total === 0) throw Object.assign(new Error("Team request body is required."), { statusCode: 400 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error("Team request body must be valid JSON."), { statusCode: 400 });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error("Team request body must be a JSON object."), { statusCode: 400 });
    }
    return parsed as Record<string, unknown>;
  }

  function teamErrorStatus(code: TeamError["code"]): number {
    return code === "validation" ? 400 : code === "unauthorized" ? 401 : code === "forbidden" ? 403 : code === "not_found" ? 404 : 409;
  }

  async function handleTeamRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (rateLimiter) {
      const verdict = rateLimiter.check(req.socket.remoteAddress);
      if (!verdict.allowed) {
        sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(verdict.retryAfterSeconds) });
        return;
      }
    }
    if (!teamStore) {
      sendJson(res, 503, { error: "team_store_unavailable" });
      return;
    }
    try {
      if (pathname === "/teams" && req.method === "POST") {
        if (!isSingleUser(req)) { sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" }); return; }
        const body = await readTeamJsonBody(req);
        const created = await teamStore.createTeam({ name: body.name, ownerEmail: body.ownerEmail, contextIndex: body.contextIndex });
        sendJson(res, 201, { team: teamView(created.team), owner: memberView(created.owner), ownerToken: created.ownerToken });
        return;
      }
      if (pathname === "/teams/accept" && req.method === "POST") {
        const body = await readTeamJsonBody(req);
        const accepted = await teamStore.acceptInvite(body.inviteToken, body.email);
        sendJson(res, 200, { team: teamView(accepted.team), member: memberView(accepted.member), memberToken: accepted.memberToken });
        return;
      }
      const match = pathname.match(/^\/teams\/([^/]+)(?:\/(invites|members|revoke|context-index))?$/);
      if (!match) { sendJson(res, 404, { error: "not_found" }); return; }
      const teamId = decodeURIComponent(match[1]);
      const sub = match[2];
      const team = await teamStore.getTeam(teamId).catch((error: unknown) => {
        if (error instanceof TeamError && error.code === "not_found") return undefined;
        throw error;
      });
      if (!team) { sendJson(res, 404, { error: "not_found" }); return; }
      const principal = await teamStore.authenticate(bearerValue(req));
      const isTeamMember = principal !== undefined && principal.team.id === team.id;
      const isTeamOwner = isTeamMember && principal.member.role === "owner";

      if (sub === "invites" && req.method === "POST") {
        if (!isTeamOwner && !isSingleUser(req)) { sendJson(res, 403, { error: "forbidden" }); return; }
        const body = await readTeamJsonBody(req);
        const created = await teamStore.createInvite(team.id, body.email);
        sendJson(res, 201, { teamId: team.id, invite: { email: created.invite.email, status: created.invite.status, invitePrefix: created.invite.invitePrefix, createdAt: created.invite.createdAt }, inviteToken: created.inviteToken });
        return;
      }
      if (sub === "members" && req.method === "GET") {
        if (!isTeamMember && !isSingleUser(req)) { sendJson(res, 403, { error: "forbidden" }); return; }
        const members = await teamStore.listMembers(team.id);
        sendJson(res, 200, { teamId: team.id, members: members.map(memberView) });
        return;
      }
      if (sub === "revoke" && req.method === "POST") {
        if (!isTeamOwner && !isSingleUser(req)) { sendJson(res, 403, { error: "forbidden" }); return; }
        const body = await readTeamJsonBody(req);
        const revoked = await teamStore.revokeMember(team.id, body.email);
        sendJson(res, 200, { teamId: team.id, member: memberView(revoked) });
        return;
      }
      if (sub === "context-index" && req.method === "GET") {
        if (!isTeamMember) { sendJson(res, 403, { error: "forbidden" }); return; }
        sendJson(res, 200, { teamId: team.id, contextIndex: team.contextIndex ?? null });
        return;
      }
      if (sub === "context-index" && req.method === "PUT") {
        if (!isTeamOwner) { sendJson(res, 403, { error: "forbidden" }); return; }
        const body = await readTeamJsonBody(req);
        const updated = await teamStore.setContextIndex(team.id, body.contextIndex);
        sendJson(res, 200, { teamId: updated.id, contextIndex: updated.contextIndex ?? null });
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof TeamError) {
        sendJson(res, teamErrorStatus(error.code), { error: error.code, message: error.message });
        return;
      }
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 400;
      sendJson(res, Number.isInteger(statusCode) ? statusCode : 400, { error: "invalid_request" });
    }
  }

  async function handleMemberDelete(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (rateLimiter) {
      const verdict = rateLimiter.check(req.socket.remoteAddress);
      if (!verdict.allowed) {
        sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(verdict.retryAfterSeconds) });
        return;
      }
    }
    if (!teamStore) { sendJson(res, 503, { error: "team_store_unavailable" }); return; }
    const match = pathname.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/);
    if (!match) { sendJson(res, 404, { error: "not_found" }); return; }
    try {
      const teamId = decodeURIComponent(match[1]);
      const email = decodeURIComponent(match[2]);
      const team = await teamStore.getTeam(teamId);
      const principal = await teamStore.authenticate(bearerValue(req));
      const isTeamOwner = principal !== undefined && principal.team.id === team.id && principal.member.role === "owner";
      if (!isTeamOwner && !isSingleUser(req)) { sendJson(res, 403, { error: "forbidden" }); return; }
      const revoked = await teamStore.revokeMember(team.id, email);
      sendJson(res, 200, { teamId: team.id, member: memberView(revoked) });
    } catch (error) {
      if (error instanceof TeamError) { sendJson(res, teamErrorStatus(error.code), { error: error.code, message: error.message }); return; }
      sendJson(res, 400, { error: "invalid_request" });
    }
  }

  return createNodeHttpServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? "/", "http://solvelang.invalid").pathname;
      if (pathname === REMOTE_MCP_HEALTH_PATH && req.method === "GET") {
        sendJson(res, 200, { status: "ok", service: "solvelang-mcp", mode: "remote-read-only" });
        return;
      }
      if (pathname === REMOTE_OPENAI_APPS_CHALLENGE_PATH && req.method === "GET" && openaiChallengeToken) {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(openaiChallengeToken);
        return;
      }
      if (pathname === "/teams" || pathname.startsWith("/teams/")) {
        if (req.method === "DELETE" && /^\/teams\/[^/]+\/members\/[^/]+$/.test(pathname)) {
          await handleMemberDelete(req, res, pathname);
        } else {
          await handleTeamRoute(req, res, pathname);
        }
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
      if (rateLimiter) {
        const verdict = rateLimiter.check(req.socket.remoteAddress);
        if (!verdict.allowed) {
          sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(verdict.retryAfterSeconds) });
          return;
        }
      }
      if (authMode === "bearer" && !isSingleUser(req)) {
        const teamPrincipal = teamStore ? await teamStore.authenticate(bearerValue(req)) : undefined;
        if (!teamPrincipal) {
          sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
          return;
        }
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

      const mcpServer = createRemoteSolveLangMcpServer({ authMode, rateLimit });
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
  testToken?: string;
  teamStore?: TeamStore;
  authMode?: RemoteAuthMode;
  host?: string;
  port?: number;
  mcpPath?: string;
  openaiChallengeToken?: string;
  rateLimit?: Partial<RemoteRateLimit> | false;
}>;

function remoteRateLimitFromEnvironment(): Partial<RemoteRateLimit> | undefined {
  const limitRaw = process.env.SOLVELANG_REMOTE_RATE_LIMIT;
  const windowRaw = process.env.SOLVELANG_REMOTE_RATE_WINDOW_MS;
  if (limitRaw === undefined && windowRaw === undefined) return undefined;
  const parsed: { limit?: number; windowMs?: number } = {};
  if (limitRaw !== undefined) {
    const limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit)) throw new Error("SOLVELANG_REMOTE_RATE_LIMIT must be an integer (0 disables the limiter).");
    parsed.limit = limit;
  }
  if (windowRaw !== undefined) {
    const windowMs = Number(windowRaw);
    if (!Number.isSafeInteger(windowMs)) throw new Error("SOLVELANG_REMOTE_RATE_WINDOW_MS must be an integer number of milliseconds.");
    parsed.windowMs = windowMs;
  }
  return parsed;
}

export async function startRemoteSolveLangServer(options: StartRemoteSolveLangServerOptions = {}): Promise<HttpServer> {
  const authMode = options.authMode ?? normalizeRemoteAuthMode(process.env.SOLVELANG_REMOTE_AUTH_MODE);
  const bearerToken = options.bearerToken ?? process.env.SOLVELANG_REMOTE_BEARER_TOKEN;
  const testToken = options.testToken ?? process.env[REMOTE_MCP_TEST_TOKEN_ENV];
  const openaiChallengeToken = options.openaiChallengeToken ?? process.env.SOLVELANG_OPENAI_APPS_CHALLENGE_TOKEN;
  const host = options.host ?? process.env.SOLVELANG_REMOTE_HOST ?? "127.0.0.1";
  const configuredPort = options.port ?? Number(process.env.PORT ?? process.env.SOLVELANG_REMOTE_PORT ?? "8787");
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
    throw new Error("Remote MCP port must be an integer from 0 through 65535.");
  }
  const mcpPath = options.mcpPath ?? process.env.SOLVELANG_REMOTE_PATH ?? REMOTE_MCP_DEFAULT_PATH;
  const rateLimit = options.rateLimit ?? remoteRateLimitFromEnvironment();
  const teamStore = options.teamStore ?? (authMode === "bearer" ? await teamStoreFromEnvironment() : undefined);
  const server = createRemoteSolveLangHttpServer({ bearerToken, testToken, authMode, mcpPath, openaiChallengeToken, rateLimit, teamStore });
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
