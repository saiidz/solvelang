#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeN8nText } from "./n8n.js";
import { readWorkspaceText, resolveWorkspacePath, workspaceRoot } from "./workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
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
    instructions: "Use SolveLang tools for deterministic workflow validation. All v1 tools are read-only, workspace-confined, bounded to 2 MB files, and never execute uploaded workflows.",
  },
);

server.registerTool(
  "solvelang_analyze_n8n",
  {
    title: "Analyze n8n workflow",
    description: "Read an n8n JSON export inside the configured workspace and return deterministic structural findings. The workflow is never executed.",
    inputSchema: z.object({ path: z.string().min(1).describe("Workspace-relative path to an n8n JSON export") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath }) => {
    const { text } = await readWorkspaceText(inputPath);
    return textResult(analyzeN8nText(text));
  },
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
    description: "Generate a deterministic Markdown or JSON preflight report for an n8n workflow without writing files.",
    inputSchema: z.object({
      path: z.string().min(1),
      format: z.enum(["markdown", "json"]).default("markdown"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: inputPath, format }) => {
    const { text } = await readWorkspaceText(inputPath);
    const report = analyzeN8nText(text);
    if (format === "json") return textResult(report);
    const findings = report.findings.map((finding) => `## ${finding.severity.toUpperCase()} — ${finding.title}\n\n${finding.detail}\n\n**Recommendation:** ${finding.recommendation}${finding.nodes?.length ? `\n\n**Nodes:** ${finding.nodes.join(", ")}` : ""}`).join("\n\n");
    return textResult(`# SolveLang Workflow Preflight\n\n**Workflow:** ${report.workflowName}\n\n**Score:** ${report.score}/100\n\n**Nodes:** ${report.nodeCount}\n\n**Connections:** ${report.connectionCount}\n\n${findings}\n\n---\nDeterministic structural analysis only. The workflow was not executed.`);
  },
);

server.registerTool(
  "solvelang_capabilities",
  {
    title: "List SolveLang capabilities",
    description: "Describe available checks, privacy boundaries, file limits, and required local dependencies.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => textResult({
    workspaceRoot: workspaceRoot(),
    limits: { maxFileBytes: 2 * 1024 * 1024, maxN8nNodes: 5000 },
    tools: ["solvelang_analyze_n8n", "solvelang_validate_solve", "solvelang_generate_n8n_report", "solvelang_capabilities"],
    privacy: ["No workflow execution", "No network calls", "No credential-value inspection", "No file writes", "Paths cannot escape the configured workspace"],
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
