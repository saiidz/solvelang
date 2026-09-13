import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MAX_CONTEXT_BUDGET_BYTES,
  MIN_CONTEXT_BUDGET_BYTES,
} from "./context-pack.js";
import {
  buildWorkspaceContextPack,
  MAX_CONTEXT_DISCOVERY_BYTES,
  MAX_CONTEXT_DISCOVERY_CANDIDATES,
  MAX_CONTEXT_DISCOVERY_DEPTH,
  MAX_CONTEXT_DISCOVERY_ENTRIES,
  MAX_CONTEXT_EXPLICIT_PATHS,
  planWorkspaceContext,
  retrieveWorkspaceContext,
} from "./context-workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const contextBuildInputSchema = z.object({
  task: z.string().min(1).max(16_384).describe("Coding task or question used only for deterministic local relevance ranking"),
  paths: z.array(z.string().min(1).max(4_096)).min(1).max(MAX_CONTEXT_EXPLICIT_PATHS).optional()
    .describe("Optional explicit workspace-relative text files. When omitted, bounded local discovery is used."),
  budgetBytes: z.number().int().min(MIN_CONTEXT_BUDGET_BYTES).max(MAX_CONTEXT_BUDGET_BYTES).optional()
    .describe("Maximum UTF-8 bytes of exact source excerpts in the pack"),
});

const contextRetrieveInputSchema = z.object({
  handle: z.string().regex(/^ctx_[a-f0-9]{32}$/),
  path: z.string().min(1).max(4_096),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  excerptSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((value) => value.endLine >= value.startLine, {
  message: "endLine must be greater than or equal to startLine.",
  path: ["endLine"],
});

export function registerContextTools(server: McpServer): void {
  server.registerTool(
    "solvelang_context_plan",
    {
      title: "Plan coding-agent context",
      description: "Select bounded task-relevant workspace excerpts for Claude Code or Codex and return provenance/hashes without returning source content. Local, deterministic, read-only, and no model calls.",
      inputSchema: contextBuildInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, paths, budgetBytes }) => textResult(await planWorkspaceContext(task, { paths, budgetBytes })),
  );

  server.registerTool(
    "solvelang_context_pack",
    {
      title: "Build coding-agent context pack",
      description: "Build a deterministic content-addressed pack of exact task-relevant workspace excerpts for Claude Code or Codex. No hidden summarization, network calls, repository writes, or credential reads.",
      inputSchema: contextBuildInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, paths, budgetBytes }) => textResult(await buildWorkspaceContextPack(task, { paths, budgetBytes })),
  );

  server.registerTool(
    "solvelang_context_retrieve",
    {
      title: "Retrieve exact context excerpt",
      description: "Retrieve an exact workspace excerpt by content-addressed provenance. Fails if the source changed, the hashes do not match, the handle is wrong, or the path is sensitive.",
      inputSchema: contextRetrieveInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => textResult(await retrieveWorkspaceContext(input)),
  );

  server.registerTool(
    "solvelang_context_capabilities",
    {
      title: "Describe Solve Context capabilities",
      description: "Describe Solve Context v0 discovery, budgeting, privacy, and correctness boundaries.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult({
      product: "Solve Context",
      status: "experimental-v0",
      clients: ["Claude Code", "Codex"],
      tools: [
        "solvelang_context_plan",
        "solvelang_context_pack",
        "solvelang_context_retrieve",
        "solvelang_context_capabilities",
      ],
      limits: {
        budgetBytes: { min: MIN_CONTEXT_BUDGET_BYTES, max: MAX_CONTEXT_BUDGET_BYTES },
        explicitPaths: MAX_CONTEXT_EXPLICIT_PATHS,
        discoveryEntries: MAX_CONTEXT_DISCOVERY_ENTRIES,
        discoveryCandidates: MAX_CONTEXT_DISCOVERY_CANDIDATES,
        discoveryBytes: MAX_CONTEXT_DISCOVERY_BYTES,
        discoveryDepth: MAX_CONTEXT_DISCOVERY_DEPTH,
      },
      invariants: [
        "Local deterministic ranking only; no LLM call",
        "Read-only workspace access; no repository mutation",
        "Automatic discovery skips vendor/build trees and likely secret paths",
        "Exact source excerpts only; no hidden summarization",
        "Content-addressed SHA-256 provenance",
        "Retrieval rejects stale source identities",
        "Discovery and pack truncation are reported explicitly",
      ],
    }),
  );
}
