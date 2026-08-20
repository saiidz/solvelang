#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeN8nText, MAX_N8N_BYTES, MAX_N8N_NODES } from "./n8n.js";
import { explainSolveGraphAlternativePaths, findSolveGraphAlternativePaths } from "./solve-graph-alternative-paths.js";
import { explainSolveGraphImpact } from "./solve-graph-impact-explanation.js";
import { findSolveGraphAffectedValidations } from "./solve-graph-affected-validations.js";
import { findSolveGraphCycles } from "./solve-graph-cycles.js";
import { findSolveGraphHotspots } from "./solve-graph-hotspots.js";
import { findSolveGraphEntrypointCandidates } from "./solve-graph-entrypoints.js";
import { findSolveGraphUnreachableCandidates } from "./solve-graph-unreachable-candidates.js";
import { summarizeSolveGraphSecurity } from "./solve-graph-security-summary.js";
import { searchSolveGraphNodesRanked } from "./solve-graph-ranked-search.js";
import { explainSolveGraphShortestPath } from "./solve-graph-shortest-path-explanation.js";
import { findSolveGraphShortestPath } from "./solve-graph-shortest-path.js";
import {
  MAX_SOLVE_GRAPH_BYTES,
  executeSolveGraphTool,
  parseSolveGraphText,
  solveGraphEdgeKinds,
  solveGraphNodeKinds,
  type SolveGraphDocument,
} from "./solve-graph.js";
import { readWorkspaceText, resolveWorkspaceFilePath, workspaceRoot } from "./workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

const n8nInputFields = {
  path: z.string().min(1).optional().describe("Workspace-relative path to an n8n JSON export"),
  rawJson: z.string().min(1).optional().describe("Raw n8n workflow JSON processed only in memory"),
};

function requireExactlyOneInput<T extends { path?: string; rawJson?: string }>(value: T, context: z.RefinementCtx) {
  if (Boolean(value.path) === Boolean(value.rawJson)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of path or rawJson." });
  }
}

const n8nInputSchema = z.object(n8nInputFields).superRefine(requireExactlyOneInput);
const n8nReportInputSchema = z.object({
  ...n8nInputFields,
  format: z.enum(["markdown", "json"]).default("markdown"),
}).superRefine(requireExactlyOneInput);

type N8nInput = z.infer<typeof n8nInputSchema>;

async function readN8nInput(input: N8nInput): Promise<string> {
  if (input.rawJson !== undefined) {
    if (Buffer.byteLength(input.rawJson, "utf8") > MAX_N8N_BYTES) throw new Error("The workflow exceeds the 2 MB safety limit.");
    return input.rawJson;
  }
  const { text } = await readWorkspaceText(input.path!);
  return text;
}

const solveGraphInputFields = {
  path: z.string().min(1).optional().describe("Workspace-relative path to a canonical Solve Graph JSON document"),
  rawJson: z.string().min(1).optional().describe("Raw canonical Solve Graph JSON processed only in memory"),
};

const solveGraphFindInputSchema = z.object({
  ...solveGraphInputFields,
  kinds: z.array(z.enum(solveGraphNodeKinds)).max(solveGraphNodeKinds.length).optional(),
  text: z.string().min(1).max(2_048).optional(),
  evidencePath: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphRankedSearchInputSchema = z.object({
  ...solveGraphInputFields,
  query: z.string().min(1).max(512),
  kinds: z.array(z.enum(solveGraphNodeKinds)).max(solveGraphNodeKinds.length).optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphTraversalInputSchema = z.object({
  ...solveGraphInputFields,
  rootIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphImpactInputSchema = z.object({
  ...solveGraphInputFields,
  changedNodeIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphImpactExplanationInputSchema = z.object({
  ...solveGraphInputFields,
  changedNodeIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
  maxRows: z.number().int().min(1).max(256).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphAffectedValidationsInputSchema = z.object({
  ...solveGraphInputFields,
  changedNodeIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
  maxValidations: z.number().int().min(1).max(100).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphCyclesInputSchema = z.object({
  ...solveGraphInputFields,
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxComponents: z.number().int().min(1).max(100).optional(),
  maxNodesPerComponent: z.number().int().min(1).max(100).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphHotspotsInputSchema = z.object({
  ...solveGraphInputFields,
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxHotspots: z.number().int().min(1).max(100).optional(),
  maxImpactDepth: z.number().int().min(0).max(64).optional(),
  maxImpactResults: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);
const solveGraphEntrypointsInputSchema = z.object({ ...solveGraphInputFields, maxCandidates: z.number().int().min(1).max(100).optional() }).superRefine(requireExactlyOneInput);
const solveGraphUnreachableInputSchema = z.object({ ...solveGraphInputFields, entrypointIds: z.array(z.string().regex(/^sgn_[a-f0-9]{32}$/)).min(1).max(128), edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(), maxDepth: z.number().int().min(0).max(64).optional(), maxResults: z.number().int().min(1).max(10_000).optional(), maxCandidates: z.number().int().min(1).max(100).optional() }).superRefine(requireExactlyOneInput);
const solveGraphSecuritySummaryInputSchema = z.object({ ...solveGraphInputFields, maxNodes: z.number().int().min(1).max(100).optional(), maxRelationships: z.number().int().min(1).max(100).optional() }).superRefine(requireExactlyOneInput);

const solveGraphShortestPathInputSchema = z.object({
  ...solveGraphInputFields,
  sourceId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  targetId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  direction: z.enum(["dependencies", "dependents"]).optional(),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(64).optional(),
  maxVisited: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);

const solveGraphAlternativePathsInputSchema = z.object({
  ...solveGraphInputFields,
  sourceId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  targetId: z.string().regex(/^sgn_[a-f0-9]{32}$/),
  direction: z.enum(["dependencies", "dependents"]).optional(),
  edgeKinds: z.array(z.enum(solveGraphEdgeKinds)).max(solveGraphEdgeKinds.length).optional(),
  maxDepth: z.number().int().min(0).max(32).optional(),
  maxPaths: z.number().int().min(1).max(32).optional(),
  maxStates: z.number().int().min(1).max(10_000).optional(),
}).superRefine(requireExactlyOneInput);

type SolveGraphInput = { path?: string; rawJson?: string };

async function readSolveGraphInput(input: SolveGraphInput): Promise<SolveGraphDocument> {
  if (input.rawJson !== undefined) {
    if (Buffer.byteLength(input.rawJson, "utf8") > MAX_SOLVE_GRAPH_BYTES) throw new Error("The Solve Graph exceeds the 2 MB safety limit.");
    return parseSolveGraphText(input.rawJson);
  }
  const { text } = await readWorkspaceText(input.path!);
  return parseSolveGraphText(text);
}

async function runSolvec(filePath: string): Promise<{ ok: boolean; output: string }> {
  const configured = process.env.SOLVELANG_SOLVEC;
  const candidates = [
    configured,
    path.join(workspaceRoot(), "solvec", "target", "release", process.platform === "win32" ? "solvec.exe" : "solvec"),
    "solvec",
  ].filter((value): value is string => Boolean(value));

  let lastError = "solvec was not found.";
  for (const command of candidates) {
    try {
      const result = await new Promise<{ code: number; output: string }>((resolve, reject) => {
        const child = spawn(command, ["validate", filePath], { cwd: workspaceRoot(), stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk) => { output += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, output: output.trim() }));
      });
      return { ok: result.code === 0, output: result.output || (result.code === 0 ? "Validation passed." : "Validation failed.") };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Unable to run solvec. Set SOLVELANG_SOLVEC to the executable path. ${lastError}`);
}

const server = new McpServer(
  { name: "solvelang", version: "0.2.0" },
  {
    instructions: "Use SolveLang tools for deterministic workflow and Solve Graph analysis. Tools are read-only, bounded to 2 MB inputs and 5,000 n8n nodes, never execute workflows, never mutate repositories, and process raw JSON only in memory.",
  },
);

server.registerTool(
  "solvelang_analyze_n8n",
  {
    title: "Analyze n8n workflow",
    description: "Analyze either a workspace-relative n8n JSON export or raw JSON supplied directly. Raw JSON is processed only in memory and is never written or sent over the network.",
    inputSchema: n8nInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => textResult(analyzeN8nText(await readN8nInput(input))),
);

server.registerTool(
  "solvelang_validate_solve",
  {
    title: "Validate SolveLang file",
    description: "Run the local solvec validator against a workspace-confined .solve file. Requires a built solvec binary or SOLVELANG_SOLVEC.",
    inputSchema: z.object({ path: z.string().min(1).describe("Workspace-relative path to a .solve file") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath }) => {
    const absolutePath = await resolveWorkspaceFilePath(inputPath);
    if (!absolutePath.endsWith(".solve")) throw new Error("The validation tool accepts .solve files only.");
    await readWorkspaceText(inputPath);
    return textResult(await runSolvec(absolutePath));
  },
);

server.registerTool(
  "solvelang_generate_n8n_report",
  {
    title: "Generate n8n report",
    description: "Generate a deterministic Markdown or CI-friendly JSON preflight report from a workspace file or raw in-memory JSON without writing files.",
    inputSchema: n8nReportInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => {
    const report = analyzeN8nText(await readN8nInput(input));
    if (input.format === "json") return textResult(report);
    const findings = report.findings.map((finding) => `## ${finding.severity.toUpperCase()} — ${finding.title}\n\n${finding.detail}\n\n**Evidence:** ${finding.evidence}\n\n**Recommendation:** ${finding.recommendation}${finding.nodes?.length ? `\n\n**Nodes:** ${finding.nodes.join(", ")}` : ""}`).join("\n\n");
    return textResult(`# SolveLang Workflow Preflight\n\n**Workflow:** ${report.workflowName}\n\n**Result:** ${report.pass ? "PASS" : "FAIL"}\n\n**Score:** ${report.score}/100\n\n**Nodes:** ${report.nodeCount}\n\n**Connections:** ${report.connectionCount}\n\n${findings}\n\n---\nDeterministic structural analysis only. The workflow was not executed.`);
  },
);

server.registerTool(
  "solvelang_graph_find_nodes",
  {
    title: "Find Solve Graph nodes",
    description: "Search an integrity-valid analyze-only Solve Graph by node kind, text, or exact evidence path. Returns bounded node summaries only.",
    inputSchema: solveGraphFindInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, kinds, text, evidencePath, limit }) => textResult(executeSolveGraphTool(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { tool: "solve_graph.find_nodes", query: { kinds, text, evidencePath, limit } },
  )),
);

server.registerTool(
  "solvelang_graph_search_nodes",
  {
    title: "Rank Solve Graph node matches",
    description: "Rank bounded node matches in an integrity-valid analyze-only Solve Graph using deterministic label, identity, evidence-path, and string-metadata evidence. Returns safe node summaries plus explicit match reasons.",
    inputSchema: solveGraphRankedSearchInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, query, kinds, limit }) => textResult(searchSolveGraphNodesRanked(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    query,
    { kinds, limit },
  )),
);

server.registerTool(
  "solvelang_graph_dependencies",
  {
    title: "Traverse Solve Graph dependencies",
    description: "Traverse outbound dependency edges from one or more stable Solve Graph node IDs with explicit depth, result, and edge-kind bounds.",
    inputSchema: solveGraphTraversalInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, rootIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { tool: "solve_graph.dependencies", rootIds, options: { edgeKinds, maxDepth, maxResults } },
  )),
);

server.registerTool(
  "solvelang_graph_dependents",
  {
    title: "Traverse Solve Graph dependents",
    description: "Traverse inbound dependency edges from one or more stable Solve Graph node IDs with explicit depth, result, and edge-kind bounds.",
    inputSchema: solveGraphTraversalInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, rootIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { tool: "solve_graph.dependents", rootIds, options: { edgeKinds, maxDepth, maxResults } },
  )),
);

server.registerTool(
  "solvelang_graph_shortest_path",
  {
    title: "Find shortest Solve Graph path",
    description: "Find one deterministic bounded shortest dependency or dependent path between stable Solve Graph node IDs, with explicit edge-kind, depth, and visited-node bounds.",
    inputSchema: solveGraphShortestPathInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, sourceId, targetId, direction, edgeKinds, maxDepth, maxVisited }) => textResult(findSolveGraphShortestPath(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    sourceId,
    targetId,
    { direction, edgeKinds, maxDepth, maxVisited },
  )),
);

server.registerTool(
  "solvelang_graph_explain_shortest_path",
  {
    title: "Explain shortest Solve Graph path",
    description: "Find and explain one deterministic bounded shortest dependency or dependent path using safe structural summaries, preserving complete-versus-partial search truth without executing repository code.",
    inputSchema: solveGraphShortestPathInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, sourceId, targetId, direction, edgeKinds, maxDepth, maxVisited }) => textResult(explainSolveGraphShortestPath(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    sourceId,
    targetId,
    { direction, edgeKinds, maxDepth, maxVisited },
  )),
);

server.registerTool(
  "solvelang_graph_alternative_paths",
  {
    title: "Find alternative Solve Graph paths",
    description: "Enumerate deterministic bounded simple dependency or dependent paths between stable Solve Graph node IDs, with explicit edge-kind, depth, path-count, and traversal-state bounds.",
    inputSchema: solveGraphAlternativePathsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, sourceId, targetId, direction, edgeKinds, maxDepth, maxPaths, maxStates }) => textResult(findSolveGraphAlternativePaths(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    sourceId,
    targetId,
    { direction, edgeKinds, maxDepth, maxPaths, maxStates },
  )),
);

server.registerTool(
  "solvelang_graph_explain_alternative_paths",
  {
    title: "Explain alternative Solve Graph paths",
    description: "Find and explain deterministic bounded simple dependency or dependent paths with explicit complete-versus-partial truth for depth, path-count, and traversal-state limits.",
    inputSchema: solveGraphAlternativePathsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, sourceId, targetId, direction, edgeKinds, maxDepth, maxPaths, maxStates }) => textResult(explainSolveGraphAlternativePaths(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    sourceId,
    targetId,
    { direction, edgeKinds, maxDepth, maxPaths, maxStates },
  )),
);

server.registerTool(
  "solvelang_graph_impact",
  {
    title: "Analyze Solve Graph impact",
    description: "Compute bounded transitive dependents for changed stable node IDs while excluding containment-only noise by default.",
    inputSchema: solveGraphImpactInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, changedNodeIds, edgeKinds, maxDepth, maxResults }) => textResult(executeSolveGraphTool(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { tool: "solve_graph.impact", changedNodeIds, options: { edgeKinds, maxDepth, maxResults } },
  )),
);

server.registerTool(
  "solvelang_graph_explain_impact",
  {
    title: "Explain Solve Graph impact",
    description: "Compute and explain bounded transitive dependent impact for changed stable node IDs while preserving complete-versus-partial traversal truth and separate explanation-row truncation.",
    inputSchema: solveGraphImpactExplanationInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, changedNodeIds, edgeKinds, maxDepth, maxResults, maxRows }) => textResult(explainSolveGraphImpact(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    changedNodeIds,
    { edgeKinds, maxDepth, maxResults, maxRows },
  )),
);

server.registerTool(
  "solvelang_graph_affected_validations",
  {
    title: "Find affected Solve Graph validation candidates",
    description: "Find bounded structural test, workflow, and job candidates among transitive dependents of changed stable node IDs. Results are graph evidence only and do not establish runtime test selection or completeness.",
    inputSchema: solveGraphAffectedValidationsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, changedNodeIds, edgeKinds, maxDepth, maxResults, maxValidations }) => textResult(findSolveGraphAffectedValidations(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    changedNodeIds,
    { edgeKinds, maxDepth, maxResults, maxValidations },
  )),
);

server.registerTool(
  "solvelang_graph_cycles",
  {
    title: "Find Solve Graph cycles",
    description: "Find deterministic bounded strongly connected components and representative directed cycles in an integrity-valid analyze-only Solve Graph. Cycles are structural evidence, not automatic defects.",
    inputSchema: solveGraphCyclesInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, edgeKinds, maxComponents, maxNodesPerComponent }) => textResult(findSolveGraphCycles(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { edgeKinds, maxComponents, maxNodesPerComponent },
  )),
);

server.registerTool(
  "solvelang_graph_hotspots",
  {
    title: "Find Solve Graph hotspot candidates",
    description: "Rank bounded structural hotspot candidates by direct and transitive dependents in an integrity-valid analyze-only Solve Graph. Results are candidate evidence, not runtime criticality or defect claims.",
    inputSchema: solveGraphHotspotsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, rawJson, edgeKinds, maxHotspots, maxImpactDepth, maxImpactResults }) => textResult(findSolveGraphHotspots(
    await readSolveGraphInput({ path: inputPath, rawJson }),
    { edgeKinds, maxHotspots, maxImpactDepth, maxImpactResults },
  )),
);
server.registerTool("solvelang_graph_entrypoint_candidates", { title: "Find Solve Graph entrypoint candidates", description: "Return bounded structural route, workflow, job, and exposes-related entrypoint candidates from an integrity-valid analyze-only graph. This does not establish runtime reachability or public exposure.", inputSchema: solveGraphEntrypointsInputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ path: inputPath, rawJson, maxCandidates }) => textResult(findSolveGraphEntrypointCandidates(await readSolveGraphInput({ path: inputPath, rawJson }), { maxCandidates })));
server.registerTool("solvelang_graph_unreachable_candidates", { title: "Find structurally unreached Solve Graph candidates", description: "Return bounded nodes not reached from selected entrypoint IDs in an analyze-only graph. Results are static candidates, not runtime unreachability or dead-code findings.", inputSchema: solveGraphUnreachableInputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ path: inputPath, rawJson, entrypointIds, edgeKinds, maxDepth, maxResults, maxCandidates }) => textResult(findSolveGraphUnreachableCandidates(await readSolveGraphInput({ path: inputPath, rawJson }), entrypointIds, { edgeKinds, maxDepth, maxResults, maxCandidates })));
server.registerTool("solvelang_graph_security_summary", { title: "Summarize Solve Graph security candidates", description: "Return bounded structural permission, resource, route, and security-relevant relationship candidates from an integrity-valid analyze-only graph. This is not a security audit.", inputSchema: solveGraphSecuritySummaryInputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ path: inputPath, rawJson, maxNodes, maxRelationships }) => textResult(summarizeSolveGraphSecurity(await readSolveGraphInput({ path: inputPath, rawJson }), { maxNodes, maxRelationships })));

server.registerTool(
  "solvelang_capabilities",
  {
    title: "List SolveLang capabilities",
    description: "Describe available checks, privacy boundaries, input modes, limits, and required local dependencies.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => textResult({
    workspaceRoot: workspaceRoot(),
    limits: { maxFileBytes: MAX_N8N_BYTES, maxN8nNodes: MAX_N8N_NODES, maxSolveGraphBytes: MAX_SOLVE_GRAPH_BYTES },
    n8nInputModes: ["workspace-relative path", "raw JSON processed only in memory"],
    solveGraphInputModes: ["workspace-relative canonical graph JSON", "raw canonical graph JSON processed only in memory"],
    tools: [
      "solvelang_analyze_n8n",
      "solvelang_validate_solve",
      "solvelang_generate_n8n_report",
      "solvelang_graph_find_nodes",
      "solvelang_graph_search_nodes",
      "solvelang_graph_dependencies",
      "solvelang_graph_dependents",
      "solvelang_graph_shortest_path",
      "solvelang_graph_explain_shortest_path",
      "solvelang_graph_alternative_paths",
      "solvelang_graph_explain_alternative_paths",
      "solvelang_graph_impact",
      "solvelang_graph_explain_impact",
      "solvelang_graph_affected_validations",
      "solvelang_graph_cycles",
      "solvelang_graph_hotspots",
      "solvelang_graph_entrypoint_candidates",
      "solvelang_graph_security_summary",
      "solvelang_capabilities",
    ],
    privacy: [
      "No workflow execution",
      "No network calls",
      "No credential-value inspection",
      "No file writes",
      "Raw JSON is not logged or persisted",
      "Paths cannot escape the configured workspace",
      "Solve Graph tools require canonical integrity-valid analyze-only documents with networkAccess=false and writeAccess=false",
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SolveLang MCP server running for workspace ${workspaceRoot()}`);
}

main().catch((error) => {
  console.error("SolveLang MCP fatal error:", error);
  process.exit(1);
});
