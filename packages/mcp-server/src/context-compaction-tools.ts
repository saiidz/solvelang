import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MAX_LINE_RLE_RECORDS,
  MAX_LINE_RLE_REPEAT,
  MAX_STRUCTURED_COMPACTION_INPUT_BYTES,
  compactStructuredInput,
  expandLineRle,
} from "./context-compaction.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const compactStructuredInputSchema = z.object({
  kind: z.enum(["json", "log", "diff"]),
  path: z.string().min(1).max(4_096).optional()
    .describe("Optional workspace-relative structured text path. Preferred when the source already exists on disk."),
  rawText: z.string().min(1).max(MAX_STRUCTURED_COMPACTION_INPUT_BYTES).optional()
    .describe("Optional raw structured text processed only in memory. Tool arguments may already consume agent context, so path/upstream interception is preferred for savings."),
}).superRefine((value, context) => {
  if (Boolean(value.path) === Boolean(value.rawText)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of path or rawText." });
  }
});

const lineRleExpansionInputSchema = z.object({
  kind: z.enum(["log", "diff"]),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceBytes: z.number().int().min(1).max(MAX_STRUCTURED_COMPACTION_INPUT_BYTES),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  candidateBytes: z.number().int().min(1).max(MAX_STRUCTURED_COMPACTION_INPUT_BYTES),
  records: z.array(z.object({
    segment: z.string().min(1).max(MAX_STRUCTURED_COMPACTION_INPUT_BYTES),
    count: z.number().int().min(1).max(MAX_LINE_RLE_REPEAT),
  })).min(1).max(MAX_LINE_RLE_RECORDS),
});

export function registerContextCompactionTools(server: McpServer): void {
  server.registerTool(
    "solvelang_context_compact_structured",
    {
      title: "Compact structured Claude/Codex context",
      description: "Apply correctness-first local compaction to JSON, logs, or diffs. JSON removes only insignificant whitespace without reserializing tokens. Logs/diffs use byte-exact line RLE. Returns no payload when the candidate would not reduce bytes.",
      inputSchema: compactStructuredInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ kind, path, rawText }) => textResult(await compactStructuredInput(kind, { path, rawText })),
  );

  server.registerTool(
    "solvelang_context_expand_rle",
    {
      title: "Expand exact log/diff context",
      description: "Reconstruct byte-exact log or diff source from a Solve Context line-RLE payload after verifying candidate hash, declared byte bounds, and original source hash.",
      inputSchema: lineRleExpansionInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => textResult(expandLineRle(input)),
  );

  server.registerTool(
    "solvelang_context_compaction_capabilities",
    {
      title: "Describe structured context compaction",
      description: "Describe Solve Context structured compaction codecs, fidelity, limits, and context-savings caveats.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult({
      product: "Solve Context",
      status: "experimental-v0",
      codecs: {
        json: {
          codec: "json-whitespace-v0",
          fidelity: "json-token-exact",
          behavior: "Removes JSON whitespace only outside strings after validation; does not parse-and-reserialize the emitted representation.",
          numericLexemesPreserved: true,
          keyOrderPreserved: true,
          escapeSpellingPreserved: true,
          reversibleToOriginalWhitespace: false,
        },
        logAndDiff: {
          codec: "line-rle-v0",
          fidelity: "byte-exact",
          behavior: "Run-length encodes consecutive identical exact line segments including their original line endings.",
          reversibleToOriginal: true,
          expansionVerifiesSourceHash: true,
        },
      },
      limits: {
        inputBytes: MAX_STRUCTURED_COMPACTION_INPUT_BYTES,
        lineRleRecords: MAX_LINE_RLE_RECORDS,
        lineRleRepeatPerRecord: MAX_LINE_RLE_REPEAT,
      },
      invariants: [
        "No provider/model/network calls",
        "No repository writes",
        "Likely secret workspace paths are denied",
        "Malformed JSON is rejected rather than repaired",
        "JSON numeric token spelling is not changed by serialization",
        "Log/diff error lines remain byte-exact",
        "No compaction payload is emitted when it would not reduce payload bytes",
        "RLE expansion fails closed on hash, byte-count, or payload tampering",
      ],
      caveats: [
        "Passing rawText directly as an agent tool argument may already put that raw text in the agent transcript. Use workspace path mode or upstream tool/proxy integration when the goal is context prevention.",
        "JSON whitespace compaction preserves JSON tokens but cannot reproduce the original insignificant whitespace; retrieve the original source when byte-for-byte formatting is required.",
        "Payload byte reduction is not provider token savings and is not a quality or competitor benchmark.",
      ],
    }),
  );
}
