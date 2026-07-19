#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeN8nText, MAX_N8N_BYTES, MAX_N8N_NODES } from "./n8n.js";
import { readWorkspaceText, resolveWorkspacePath, workspaceRoot } from "./workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

const n8nInputSchema = z.object({
  path: z.string().min(1).optional().describe("Workspace-relative path to an n8n JSON export"),
  rawJson: z.string().min(1).optional().describe("Raw n8n workflow JSON processed only in memory"),
}).superRefine((value, context) => {
  if (Boolean(value.path) === Boolean(value.rawJson)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of path or rawJson." });
  }
});

type N8nInput = z.infer<typeof n8nInputSchema>;

async function readN8nInput(input: N8nInput): Promise<string> {
  if (input.rawJson !== undefined) {
    if (Buffer.byteLength(input.rawJson, "utf8") > MAX_N8N_BYTES) throw new Error("The workflow exceeds the 2 MB safety limit.");
    return input.rawJson;
  }
  const { text } = await readWorkspaceText(input.path!);
  return text;
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
  { name: "solvelang", version: "0.1.0" },
  {
    instructions: "Use SolveLang tools for deterministic workflow validation. Tools are read-only, bounded to 2 MB and 5,000 n8n nodes, never execute workflows, and process raw JSON only in memory.",
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
    const absolutePath = resolveWorkspacePath(inputPath);
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
    inputSchema: n8nInputSchema.extend({ format: z.enum(["markdown", "json"]).default("markdown") }),
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
  "solvelang_capabilities",
  {
    title: "List SolveLang capabilities",
    description: "Describe available checks, privacy boundaries, input modes, limits, and required local dependencies.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => textResult({
    workspaceRoot: workspaceRoot(),
    limits: { maxFileBytes: MAX_N8N_BYTES, maxN8nNodes: MAX_N8N_NODES },
    n8nInputModes: ["workspace-relative path", "raw JSON processed only in memory"],
    tools: ["solvelang_analyze_n8n", "solvelang_validate_solve", "solvelang_generate_n8n_report", "solvelang_capabilities"],
    privacy: ["No workflow execution", "No network calls", "No credential-value inspection", "No file writes", "Raw JSON is not logged or persisted", "Paths cannot escape the configured workspace"],
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
