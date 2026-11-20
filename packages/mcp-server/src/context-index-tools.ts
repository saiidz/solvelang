import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_CONTEXT_BUDGET_BYTES, MIN_CONTEXT_BUDGET_BYTES } from "./context-pack.js";
import {
  MAX_CONTEXT_INDEX_BYTES,
  MAX_CONTEXT_INDEX_GRAPH_BYTES,
  contextIndexStatus,
  queryContextIndex,
} from "./context-index.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerContextIndexTools(server: McpServer): void {
  server.registerTool(
    "solvelang_context_index_query",
    {
      title: "Query the persistent Solve Context index",
      description: "Answer a coding task query from the workspace's persistent Solve Context index (.solve/context-index.json) instead of re-walking the workspace: candidates are ranked from index records by lexical path/content-term scoring, declaration identifier overlap, and a one-hop Solve Graph neighborhood, then read and hash-verified against the index before the existing pack machinery excerpts them. Ranking is lexical + graph-structure — no embeddings, no model calls, no network. Read-only; the index itself is built and refreshed by the solvelang-context-index CLI.",
      inputSchema: z.object({
        task: z.string().min(1).max(16_384).describe("Coding task or question used only for deterministic local relevance ranking against the index"),
        budgetBytes: z.number().int().min(MIN_CONTEXT_BUDGET_BYTES).max(MAX_CONTEXT_BUDGET_BYTES).optional()
          .describe("Maximum UTF-8 bytes of exact source excerpts in the pack"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, budgetBytes }) => textResult(await queryContextIndex(task, { budgetBytes })),
  );

  server.registerTool(
    "solvelang_context_index_status",
    {
      title: "Report Solve Context index status",
      description: "Report whether the workspace carries a persistent Solve Context index, its provenance (source revision and fingerprint), graph reference and hash validity, and record counts. Read-only and local; building or refreshing the index is the solvelang-context-index CLI's job, not this tool's.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult(await contextIndexStatus()),
  );
}

export const CONTEXT_INDEX_TOOL_NAMES = [
  "solvelang_context_index_query",
  "solvelang_context_index_status",
] as const;

export const CONTEXT_INDEX_LIMITS = {
  indexBytes: MAX_CONTEXT_INDEX_BYTES,
  indexGraphBytes: MAX_CONTEXT_INDEX_GRAPH_BYTES,
};
