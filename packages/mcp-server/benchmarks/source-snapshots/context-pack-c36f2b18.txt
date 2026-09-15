import { createHash } from "node:crypto";

export const CONTEXT_PACK_SCHEMA = "solvelang.context.pack.v0" as const;
export const MIN_CONTEXT_BUDGET_BYTES = 1_024;
export const MAX_CONTEXT_BUDGET_BYTES = 512 * 1_024;
export const DEFAULT_CONTEXT_BUDGET_BYTES = 64 * 1_024;
export const MAX_CONTEXT_SOURCES = 512;
export const MAX_CONTEXT_SOURCE_BYTES = 2 * 1024 * 1024;

const MAX_TASK_BYTES = 16 * 1_024;
const MAX_REASON_TOKENS = 8;
const WINDOW_RADIUS = 4;

export interface ContextSourceSelection {
  score: number;
  reasons: string[];
}

export interface ContextSource {
  selection?: ContextSourceSelection;
  path: string;
  text: string;
}

export interface ContextPackEntry {
  handle: string;
  path: string;
  startLine: number;
  endLine: number;
  sourceSha256: string;
  excerptSha256: string;
  bytes: number;
  score: number;
  reasons: string[];
  content: string;
}

export interface ContextPack {
  schema: typeof CONTEXT_PACK_SCHEMA;
  packId: string;
  taskSha256: string;
  budgetBytes: number;
  selectedBytes: number;
  truncated: boolean;
  omittedCandidates: number;
  entries: ContextPackEntry[];
}

interface Candidate {
  path: string;
  startLine: number;
  endLine: number;
  sourceSha256: string;
  score: number;
  reasons: string[];
  content: string;
  bytes: number;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertBoundedText(label: string, value: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes === 0) throw new Error(`${label} must not be empty.`);
  if (bytes > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte safety limit.`);
}

export function normalizeContextPath(input: string): string {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Context source paths must be normalized workspace-relative paths.");
  }
  return normalized;
}

export function contextTaskTokens(task: string): string[] {
  const matches = task.toLowerCase().match(/[a-z0-9_./:@-]{2,}/g) ?? [];
  const deduped = new Set<string>();
  for (const token of matches) {
    const trimmed = token.replace(/^[./:@-]+|[./:@-]+$/g, "");
    if (trimmed.length >= 2) deduped.add(trimmed);
    if (deduped.size >= 128) break;
  }
  return [...deduped].sort();
}

export function contextEntryHandle(
  path: string,
  sourceSha256: string,
  startLine: number,
  endLine: number,
  excerptSha256: string,
): string {
  const normalizedPath = normalizeContextPath(path);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-f0-9]{64}$/.test(excerptSha256)) {
    throw new Error("Context entry hashes must be lowercase SHA-256 values.");
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error("Context entry line bounds are invalid.");
  }
  const digest = sha256Text(`${normalizedPath}\0${sourceSha256}\0${startLine}\0${endLine}\0${excerptSha256}`);
  return `ctx_${digest.slice(0, 32)}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const next = haystack.indexOf(needle, offset);
    if (next < 0) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function mergeRanges(ranges: Array<{ startLine: number; endLine: number }>): Array<{ startLine: number; endLine: number }> {
  const sorted = [...ranges].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  const merged: Array<{ startLine: number; endLine: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function buildCandidates(source: ContextSource, tokens: string[]): Candidate[] {
  const normalizedPath = normalizeContextPath(source.path);
  assertBoundedText(`Context source ${normalizedPath}`, source.text, MAX_CONTEXT_SOURCE_BYTES);

  const selection = source.selection;
  if (selection !== undefined) {
    if (!selection || !Number.isSafeInteger(selection.score) || selection.score < 1 || selection.score > 128
      || !Array.isArray(selection.reasons) || selection.reasons.length === 0 || selection.reasons.length > 4
      || selection.reasons.some((reason) => typeof reason !== "string" || reason.length === 0 || reason.length > 256 || /[\u0000-\u001f\u007f]/.test(reason))) {
      throw new Error("Context source selection evidence is invalid.");
    }
  }
  const selectionScore = selection?.score ?? 0;
  const selectionReasons = selection?.reasons ?? [];

  const lines = source.text.replace(/\r\n/g, "\n").split("\n");
  const lowerLines = lines.map((line) => line.toLowerCase());
  const lowerPath = normalizedPath.toLowerCase();
  const sourceSha256 = sha256Text(source.text);
  const pathReasons = tokens.filter((token) => lowerPath.includes(token));
  const pathScore = pathReasons.reduce((total, token) => total + 6 * countOccurrences(lowerPath, token), 0);

  const matchLines: Array<{ line: number; reasons: string[]; score: number }> = [];
  for (let index = 0; index < lowerLines.length; index += 1) {
    const line = lowerLines[index];
    const reasons = tokens.filter((token) => line.includes(token));
    if (reasons.length === 0) continue;
    const score = reasons.reduce((total, token) => total + 2 * countOccurrences(line, token), 0) + pathScore;
    matchLines.push({ line: index + 1, reasons, score });
  }

  if (matchLines.length === 0 && pathScore === 0 && selectionScore === 0) return [];

  const ranges = matchLines.length > 0
    ? mergeRanges(matchLines.map(({ line }) => ({ startLine: Math.max(1, line - WINDOW_RADIUS), endLine: Math.min(lines.length, line + WINDOW_RADIUS) })))
    : [{ startLine: 1, endLine: Math.min(lines.length, WINDOW_RADIUS * 2 + 1) }];

  return ranges.map(({ startLine, endLine }) => {
    const content = lines.slice(startLine - 1, endLine).join("\n");
    const lowerContent = content.toLowerCase();
    const contentReasons = tokens.filter((token) => lowerContent.includes(token));
    const lexicalReasons = [...new Set([...pathReasons, ...contentReasons])].sort();
    const reasons = [...new Set([...selectionReasons, ...lexicalReasons])].slice(0, MAX_REASON_TOKENS);
    const contentScore = contentReasons.reduce((total, token) => total + 2 * countOccurrences(lowerContent, token), 0);
    return {
      path: normalizedPath,
      startLine,
      endLine,
      sourceSha256,
      score: pathScore + contentScore + selectionScore,
      reasons,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });
}

function candidateSort(left: Candidate, right: Candidate): number {
  return right.score - left.score || compareText(left.path, right.path) || left.startLine - right.startLine || left.endLine - right.endLine;
}

function canonicalPackIdentity(taskSha256: string, budgetBytes: number, entries: ContextPackEntry[]): string {
  const identity = {
    schema: CONTEXT_PACK_SCHEMA,
    taskSha256,
    budgetBytes,
    entries: entries.map(({ handle, path, startLine, endLine, sourceSha256, excerptSha256, bytes, score, reasons }) => ({
      handle,
      path,
      startLine,
      endLine,
      sourceSha256,
      excerptSha256,
      bytes,
      score,
      reasons,
    })),
  };
  return JSON.stringify(identity);
}

export function buildContextPack(task: string, sources: ContextSource[], budgetBytes = DEFAULT_CONTEXT_BUDGET_BYTES): ContextPack {
  assertBoundedText("Context task", task, MAX_TASK_BYTES);
  if (!Number.isInteger(budgetBytes) || budgetBytes < MIN_CONTEXT_BUDGET_BYTES || budgetBytes > MAX_CONTEXT_BUDGET_BYTES) {
    throw new Error(`Context budget must be an integer between ${MIN_CONTEXT_BUDGET_BYTES} and ${MAX_CONTEXT_BUDGET_BYTES} bytes.`);
  }
  if (sources.length === 0) throw new Error("At least one context source is required.");
  if (sources.length > MAX_CONTEXT_SOURCES) throw new Error(`Context sources exceed the ${MAX_CONTEXT_SOURCES} source safety limit.`);

  const tokens = contextTaskTokens(task);
  const orderedSources = [...sources].sort((left, right) => compareText(normalizeContextPath(left.path), normalizeContextPath(right.path)));
  const candidates = orderedSources.flatMap((source) => buildCandidates(source, tokens)).sort(candidateSort);

  let selectedBytes = 0;
  const entries: ContextPackEntry[] = [];
  let omittedCandidates = 0;

  for (const candidate of candidates) {
    if (candidate.bytes === 0 || selectedBytes + candidate.bytes > budgetBytes) {
      omittedCandidates += 1;
      continue;
    }
    const excerptSha256 = sha256Text(candidate.content);
    entries.push({
      handle: contextEntryHandle(candidate.path, candidate.sourceSha256, candidate.startLine, candidate.endLine, excerptSha256),
      path: candidate.path,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      sourceSha256: candidate.sourceSha256,
      excerptSha256,
      bytes: candidate.bytes,
      score: candidate.score,
      reasons: candidate.reasons,
      content: candidate.content,
    });
    selectedBytes += candidate.bytes;
  }

  entries.sort((left, right) => compareText(left.path, right.path) || left.startLine - right.startLine || left.endLine - right.endLine);
  const taskSha256 = sha256Text(task);
  const packDigest = sha256Text(canonicalPackIdentity(taskSha256, budgetBytes, entries));

  return {
    schema: CONTEXT_PACK_SCHEMA,
    packId: `scp_${packDigest.slice(0, 32)}`,
    taskSha256,
    budgetBytes,
    selectedBytes,
    truncated: omittedCandidates > 0,
    omittedCandidates,
    entries,
  };
}
