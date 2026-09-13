import { normalizeContextPath, sha256Text } from "./context-pack.js";
import { readWorkspaceText } from "./workspace.js";

export const CONTEXT_COMPACTION_SCHEMA = "solvelang.context.compaction.v0" as const;
export const CONTEXT_EXPANSION_SCHEMA = "solvelang.context.expansion.v0" as const;
export const MAX_STRUCTURED_COMPACTION_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_LINE_RLE_RECORDS = 100_000;
export const MAX_LINE_RLE_REPEAT = 100_000;

const SENSITIVE_DIRECTORIES = new Set([".aws", ".gnupg", ".kube", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

export type StructuredCompactionKind = "json" | "log" | "diff";
export type StructuredCompactionCodec = "json-whitespace-v0" | "line-rle-v0";

export interface LineRleRecord {
  segment: string;
  count: number;
}

export type StructuredCompactionPayload =
  | { content: string }
  | { records: LineRleRecord[] };

export interface StructuredCompaction {
  schema: typeof CONTEXT_COMPACTION_SCHEMA;
  kind: StructuredCompactionKind;
  codec: StructuredCompactionCodec;
  fidelity: "json-token-exact" | "byte-exact";
  reversibleToOriginal: boolean;
  sourceSha256: string;
  sourceBytes: number;
  candidateSha256: string;
  candidateBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  applied: boolean;
  reason?: "no-byte-reduction";
  payload?: StructuredCompactionPayload;
}

export interface StructuredCompactionResult extends StructuredCompaction {
  source: { mode: "raw" } | { mode: "workspace"; path: string };
}

export interface LineRleExpansionInput {
  kind: "log" | "diff";
  sourceSha256: string;
  sourceBytes: number;
  candidateSha256: string;
  candidateBytes: number;
  records: LineRleRecord[];
}

export interface LineRleExpansion {
  schema: typeof CONTEXT_EXPANSION_SCHEMA;
  kind: "log" | "diff";
  codec: "line-rle-v0";
  sourceSha256: string;
  sourceBytes: number;
  content: string;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function assertTextInput(text: string): number {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes === 0) throw new Error("Structured compaction input must not be empty.");
  if (bytes > MAX_STRUCTURED_COMPACTION_INPUT_BYTES) {
    throw new Error(`Structured compaction input exceeds the ${MAX_STRUCTURED_COMPACTION_INPUT_BYTES} byte safety limit.`);
  }
  if (text.includes("\0")) throw new Error("Structured compaction input appears to contain binary data.");
  return bytes;
}

function isSensitivePath(inputPath: string): boolean {
  const normalized = normalizeContextPath(inputPath);
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1)!;
  if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))) return true;
  if (SENSITIVE_FILENAMES.has(basename)) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  if ([".key", ".p12", ".pfx", ".pem"].some((extension) => basename.endsWith(extension))) return true;
  return false;
}

function minifyJsonWhitespaceTokenPreserving(text: string): string {
  JSON.parse(text);
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === " " || character === "\t" || character === "\r" || character === "\n") continue;
    output += character;
  }

  if (inString || escaped) throw new Error("JSON string state ended unexpectedly.");
  return output;
}

function splitExactLineSegments(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      segments.push(text.slice(start, index + 1));
      start = index + 1;
    } else if (character === "\n") {
      segments.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) segments.push(text.slice(start));
  return segments;
}

function toLineRleRecords(text: string): LineRleRecord[] {
  const segments = splitExactLineSegments(text);
  const records: LineRleRecord[] = [];
  for (const segment of segments) {
    const previous = records.at(-1);
    if (previous && previous.segment === segment && previous.count < MAX_LINE_RLE_REPEAT) {
      previous.count += 1;
    } else {
      records.push({ segment, count: 1 });
      if (records.length > MAX_LINE_RLE_RECORDS) {
        throw new Error(`Line RLE output exceeds the ${MAX_LINE_RLE_RECORDS} record safety limit.`);
      }
    }
  }
  return records;
}

function lineRleCanonicalPayload(records: LineRleRecord[]): string {
  return JSON.stringify({ records: records.map(({ segment, count }) => ({ segment, count })) });
}

function finalizeCompaction(
  kind: StructuredCompactionKind,
  codec: StructuredCompactionCodec,
  fidelity: StructuredCompaction["fidelity"],
  reversibleToOriginal: boolean,
  sourceText: string,
  candidateText: string,
  payload: StructuredCompactionPayload,
): StructuredCompaction {
  const sourceBytes = Buffer.byteLength(sourceText, "utf8");
  const candidateBytes = Buffer.byteLength(candidateText, "utf8");
  const reductionBytes = Math.max(0, sourceBytes - candidateBytes);
  const applied = reductionBytes > 0;
  return {
    schema: CONTEXT_COMPACTION_SCHEMA,
    kind,
    codec,
    fidelity,
    reversibleToOriginal,
    sourceSha256: sha256Text(sourceText),
    sourceBytes,
    candidateSha256: sha256Text(candidateText),
    candidateBytes,
    reductionBytes,
    reductionPercent: roundPercent(sourceBytes === 0 ? 0 : 100 * reductionBytes / sourceBytes),
    applied,
    ...(applied ? { payload } : { reason: "no-byte-reduction" as const }),
  };
}

export function compactStructuredText(kind: StructuredCompactionKind, text: string): StructuredCompaction {
  assertTextInput(text);
  if (kind === "json") {
    const minified = minifyJsonWhitespaceTokenPreserving(text);
    return finalizeCompaction(
      kind,
      "json-whitespace-v0",
      "json-token-exact",
      false,
      text,
      minified,
      { content: minified },
    );
  }

  const records = toLineRleRecords(text);
  const candidate = lineRleCanonicalPayload(records);
  return finalizeCompaction(
    kind,
    "line-rle-v0",
    "byte-exact",
    true,
    text,
    candidate,
    { records },
  );
}

export async function compactStructuredInput(
  kind: StructuredCompactionKind,
  input: { path?: string; rawText?: string },
): Promise<StructuredCompactionResult> {
  if (Boolean(input.path) === Boolean(input.rawText)) throw new Error("Provide exactly one of path or rawText for structured compaction.");
  if (input.rawText !== undefined) {
    return { ...compactStructuredText(kind, input.rawText), source: { mode: "raw" } };
  }

  const normalizedPath = normalizeContextPath(input.path!);
  if (isSensitivePath(normalizedPath)) throw new Error(`Structured compaction access to sensitive path ${normalizedPath} is denied.`);
  const { text } = await readWorkspaceText(normalizedPath);
  return { ...compactStructuredText(kind, text), source: { mode: "workspace", path: normalizedPath } };
}

export function expandLineRle(input: LineRleExpansionInput): LineRleExpansion {
  if (input.kind !== "log" && input.kind !== "diff") throw new Error("Line RLE expansion supports log or diff content only.");
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256) || !/^[a-f0-9]{64}$/.test(input.candidateSha256)) {
    throw new Error("Line RLE expansion hashes must be lowercase SHA-256 values.");
  }
  if (!Number.isInteger(input.sourceBytes) || input.sourceBytes < 1 || input.sourceBytes > MAX_STRUCTURED_COMPACTION_INPUT_BYTES) {
    throw new Error("Line RLE source byte count is invalid.");
  }
  if (!Number.isInteger(input.candidateBytes) || input.candidateBytes < 1 || input.candidateBytes > MAX_STRUCTURED_COMPACTION_INPUT_BYTES) {
    throw new Error("Line RLE candidate byte count is invalid.");
  }
  if (!Array.isArray(input.records) || input.records.length === 0 || input.records.length > MAX_LINE_RLE_RECORDS) {
    throw new Error("Line RLE record count is invalid.");
  }

  const normalizedRecords = input.records.map((record) => {
    if (typeof record.segment !== "string" || record.segment.length === 0) throw new Error("Line RLE record segment must not be empty.");
    if (!Number.isInteger(record.count) || record.count < 1 || record.count > MAX_LINE_RLE_REPEAT) {
      throw new Error("Line RLE record repeat count is invalid.");
    }
    return { segment: record.segment, count: record.count };
  });
  const canonicalPayload = lineRleCanonicalPayload(normalizedRecords);
  if (Buffer.byteLength(canonicalPayload, "utf8") !== input.candidateBytes || sha256Text(canonicalPayload) !== input.candidateSha256) {
    throw new Error("Line RLE candidate payload identity does not match its declared bytes/hash.");
  }

  let reconstructedBytes = 0;
  for (const record of normalizedRecords) {
    reconstructedBytes += Buffer.byteLength(record.segment, "utf8") * record.count;
    if (reconstructedBytes > MAX_STRUCTURED_COMPACTION_INPUT_BYTES || reconstructedBytes > input.sourceBytes) {
      throw new Error("Line RLE expansion exceeds the declared source byte bound.");
    }
  }
  if (reconstructedBytes !== input.sourceBytes) throw new Error("Line RLE expansion does not match the declared source byte count.");

  const content = normalizedRecords.map(({ segment, count }) => segment.repeat(count)).join("");
  if (sha256Text(content) !== input.sourceSha256) throw new Error("Line RLE expansion does not match the declared source hash.");
  return {
    schema: CONTEXT_EXPANSION_SCHEMA,
    kind: input.kind,
    codec: "line-rle-v0",
    sourceSha256: input.sourceSha256,
    sourceBytes: input.sourceBytes,
    content,
  };
}
