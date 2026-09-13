# Solve Context structured compaction v0

Status: **experimental correctness-first compaction**  
Tracking epic: #898

## Purpose

Structured compaction is a fallback after task-aware context prevention. It exists for large JSON, log, and diff payloads that are genuinely useful to Claude Code or Codex but contain representational repetition.

V0 deliberately avoids semantic summarization and model-generated compression.

## MCP tools

- `solvelang_context_compact_structured`
- `solvelang_context_expand_rle`
- `solvelang_context_compaction_capabilities`

All are local, read-only, deterministic, and perform no provider/model/network calls.

## JSON: `json-whitespace-v0`

The JSON codec validates the input and then scans the original text lexically. It removes only JSON-insignificant spaces, tabs, CR, and LF characters that occur outside strings.

It does **not** emit `JSON.stringify(JSON.parse(input))` output.

Therefore the compacted JSON preserves the original token spelling for:

- integer and floating-point numeric lexemes,
- exponent notation,
- object key order,
- duplicate-key spelling/order as present in the validated source text,
- string escapes,
- whitespace inside strings,
- punctuation and literal tokens.

This specifically avoids converting large numeric lexemes through JavaScript `Number` serialization.

### Fidelity boundary

The emitted JSON representation is labeled `json-token-exact`. Original insignificant whitespace is not embedded in the compacted payload, so the codec does **not** claim byte-for-byte reversibility to the original formatting.

If exact original formatting is required, use the original workspace source/context retrieval path rather than treating minified JSON as an archival representation.

## Logs and diffs: `line-rle-v0`

The line codec splits text into exact segments that include the original line ending (`LF`, `CRLF`, or `CR`) and run-length encodes only consecutive identical segments.

The compacted payload stores records with:

- exact segment text,
- exact repeat count.

No error, failure, warning, diff marker, or other line text is rewritten.

### Expansion

`solvelang_context_expand_rle` reconstructs the original text only after validating:

- compacted payload byte count,
- compacted payload SHA-256,
- declared original byte bound,
- reconstructed original byte count,
- reconstructed original SHA-256.

Any mismatch fails closed.

## No false savings

A codec always calculates candidate payload bytes before returning a compacted payload. If the candidate is not smaller than the source, the result uses:

- `applied: false`
- `reason: "no-byte-reduction"`
- no compacted payload

This prevents the system from claiming a savings percentage merely because a transform was attempted.

## Input modes

`solvelang_context_compact_structured` accepts exactly one of:

- a workspace-relative path, or
- raw in-memory text.

Workspace mode uses the existing workspace confinement rules and denies likely secret paths such as `.env`, private-key material, credential files, and common credential directories.

### Context-savings caveat

Passing a giant payload as `rawText` from an agent may already put that text into the agent/tool-call transcript. For actual context prevention, prefer:

1. workspace-path mode when the structured output exists as a file, or
2. future upstream tool/proxy integration that invokes this codec before the raw payload reaches the model context.

The codec itself is therefore a reusable correctness layer for the future provider/tool-output interception path; it is not evidence that manually passing `rawText` saved model context.

## Measurement boundary

`reductionPercent` in v0 is exact UTF-8 payload-byte reduction for the codec candidate. It is not provider token savings, prompt-cache savings, latency improvement, answer-quality improvement, or a competitor comparison.
