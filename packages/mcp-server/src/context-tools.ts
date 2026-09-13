import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerContextCompactionTools } from "./context-compaction-tools.js";
import {
  CONTEXT_HANDOFF_SCHEMA,
  MAX_HANDOFF_CHANGED_PATHS,
  MAX_HANDOFF_CONTEXT_REFERENCES,
  MAX_HANDOFF_DECISIONS,
  MAX_HANDOFF_QUESTIONS,
  MAX_HANDOFF_TESTS,
  createContextHandoff,
  validateContextHandoff,
  type ContextHandoff,
} from "./context-handoff.js";
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

const contextReferenceSchema = z.object({
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

const contextRetrieveInputSchema = contextReferenceSchema;
const handoffAgentSchema = z.enum(["claude", "codex", "other"]);
const handoffTargetSchema = z.enum(["claude", "codex", "any", "other"]);
const handoffTestSchema = z.object({
  label: z.string().min(1).max(2_048),
  status: z.enum(["passed", "failed", "not_run", "unknown"]),
  evidence: z.string().min(1).max(4_096).optional(),
});

const contextHandoffCreateInputSchema = z.object({
  fromAgent: handoffAgentSchema,
  toAgent: handoffTargetSchema.optional(),
  goal: z.string().min(1).max(16_384),
  decisions: z.array(z.string().min(1).max(4_096)).max(MAX_HANDOFF_DECISIONS).optional(),
  unresolvedQuestions: z.array(z.string().min(1).max(4_096)).max(MAX_HANDOFF_QUESTIONS).optional(),
  changedPaths: z.array(z.string().min(1).max(4_096)).max(MAX_HANDOFF_CHANGED_PATHS).optional(),
  tests: z.array(handoffTestSchema).max(MAX_HANDOFF_TESTS).optional(),
  context: z.array(contextReferenceSchema).max(MAX_HANDOFF_CONTEXT_REFERENCES).optional(),
});

const contextHandoffDocumentSchema = z.object({
  schema: z.literal(CONTEXT_HANDOFF_SCHEMA),
  handoffId: z.string().regex(/^sch_[a-f0-9]{32}$/),
  fromAgent: handoffAgentSchema,
  toAgent: handoffTargetSchema,
  goal: z.string().min(1).max(16_384),
  decisions: z.array(z.string().min(1).max(4_096)).max(MAX_HANDOFF_DECISIONS),
  unresolvedQuestions: z.array(z.string().min(1).max(4_096)).max(MAX_HANDOFF_QUESTIONS),
  changedSources: z.array(z.object({
    path: z.string().min(1).max(4_096),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(2 * 1024 * 1024),
  })).max(MAX_HANDOFF_CHANGED_PATHS),
  tests: z.array(handoffTestSchema).max(MAX_HANDOFF_TESTS),
  context: z.array(contextReferenceSchema).max(MAX_HANDOFF_CONTEXT_REFERENCES),
  freshness: z.object({
    mode: z.literal("content-addressed"),
    changedSourcesVerifiedAtCreation: z.literal(true),
    contextReferencesVerifiedAtCreation: z.literal(true),
  }),
});

export function registerContextTools(server: McpServer): void {
  registerContextCompactionTools(server);

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
    "solvelang_context_handoff",
    {
      title: "Create Claude/Codex context handoff",
      description: "Create a deterministic, source-body-free task handoff for Claude Code, Codex, or another agent. Changed files and context references are verified against the current workspace before the handoff is emitted. No files are written.",
      inputSchema: contextHandoffCreateInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => textResult(await createContextHandoff(input)),
  );

  server.registerTool(
    "solvelang_context_handoff_validate",
    {
      title: "Validate Claude/Codex context handoff",
      description: "Validate handoff checksum integrity and re-check changed-file/context identities against the receiving workspace. The checksum detects handoff drift but is not an authentication signature.",
      inputSchema: z.object({ handoff: contextHandoffDocumentSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ handoff }) => textResult(await validateContextHandoff(handoff as ContextHandoff)),
  );

  server.registerTool(
    "solvelang_context_capabilities",
    {
      title: "Describe Solve Context capabilities",
      description: "Describe Solve Context v0 discovery, budgeting, handoff, compaction, privacy, and correctness boundaries.",
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
        "solvelang_context_handoff",
        "solvelang_context_handoff_validate",
        "solvelang_context_compact_structured",
        "solvelang_context_expand_rle",
        "solvelang_context_compaction_capabilities",
        "solvelang_context_capabilities",
      ],
      limits: {
        budgetBytes: { min: MIN_CONTEXT_BUDGET_BYTES, max: MAX_CONTEXT_BUDGET_BYTES },
        explicitPaths: MAX_CONTEXT_EXPLICIT_PATHS,
        discoveryEntries: MAX_CONTEXT_DISCOVERY_ENTRIES,
        discoveryCandidates: MAX_CONTEXT_DISCOVERY_CANDIDATES,
        discoveryBytes: MAX_CONTEXT_DISCOVERY_BYTES,
        discoveryDepth: MAX_CONTEXT_DISCOVERY_DEPTH,
        handoffChangedPaths: MAX_HANDOFF_CHANGED_PATHS,
        handoffContextReferences: MAX_HANDOFF_CONTEXT_REFERENCES,
        handoffDecisions: MAX_HANDOFF_DECISIONS,
        handoffQuestions: MAX_HANDOFF_QUESTIONS,
        handoffTests: MAX_HANDOFF_TESTS,
      },
      invariants: [
        "Local deterministic ranking/compaction only; no LLM call",
        "Read-only workspace access; no repository mutation",
        "Automatic discovery skips vendor/build trees and likely secret paths",
        "Exact source excerpts only; no hidden summarization",
        "Content-addressed SHA-256 provenance",
        "Retrieval rejects stale source identities",
        "Claude/Codex handoffs carry provenance instead of source bodies and can be revalidated in the receiving workspace",
        "Handoff IDs are deterministic integrity checksums, not authentication signatures",
        "Structured JSON compaction removes only insignificant whitespace without reserializing emitted JSON tokens",
        "Log/diff RLE is byte-exact and expansion verifies both compacted and original identities",
        "Compaction refuses to emit a payload when it would not reduce payload bytes",
        "Discovery and pack truncation are reported explicitly",
      ],
    }),
  );
}
