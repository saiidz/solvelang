import { createHash } from "node:crypto";

export const CONTEXT_PACK_SCHEMA = "solvelang.context.pack.v0" as const;
export const MIN_CONTEXT_BUDGET_BYTES = 1_024;
export const MAX_CONTEXT_BUDGET_BYTES = 512 * 1_024;
export const DEFAULT_CONTEXT_BUDGET_BYTES = 64 * 1_024;
export const MAX_CONTEXT_SOURCES = 512;
export const MAX_CONTEXT_SOURCE_BYTES = 2 * 1024 * 1024;

const MAX_TASK_BYTES = 16 * 1_024;
const MAX_REASON_TOKENS = 8;
const MAX_TOKEN_OCCURRENCES_PER_RANK = 2;
const WINDOW_RADIUS = 4;
const DECLARATION_WINDOW_LINES = 24;
const DECLARATION_LEADING_COMMENT_LINES = 16;

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
  lexicalTokenCount: number;
  rankingScore: number;
  declarationTextWindow?: boolean;
  selection?: ContextSourceSelection;
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

function singularTaskToken(token: string): string | undefined {
  if (token.length < 5 || !token.endsWith("s") || token.endsWith("ss") || token.endsWith("us") || token.endsWith("is")) {
    return undefined;
  }
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/.test(token)) return token.slice(0, -2);
  return token.slice(0, -1);
}

export function contextTaskTokens(task: string): string[] {
  const matches = task.toLowerCase().match(/[a-z0-9_./:@-]{2,}/g) ?? [];
  const deduped = new Set<string>();
  for (const token of matches) {
    const trimmed = token.replace(/^[./:@-]+|[./:@-]+$/g, "");
    const singular = singularTaskToken(trimmed);
    for (const candidate of [trimmed, singular]) {
      if (candidate && candidate.length >= 2 && deduped.size < 128) deduped.add(candidate);
    }
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

function boundedRankingOccurrences(haystack: string, needle: string): number {
  return Math.min(MAX_TOKEN_OCCURRENCES_PER_RANK, countOccurrences(haystack, needle));
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

/** Partition merged match windows at whole-line boundaries before ranking them.
 * A single over-budget line remains its own candidate so omission stays explicit;
 * never clip UTF-8 content or let that line hide smaller neighboring evidence.
 */
function budgetRanges(
  lines: string[],
  ranges: Array<{ startLine: number; endLine: number }>,
  budgetBytes: number,
): Array<{ startLine: number; endLine: number }> {
  const bounded: Array<{ startLine: number; endLine: number }> = [];
  for (const range of ranges) {
    let startLine = range.startLine;
    let bytes = 0;
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const lineBytes = Buffer.byteLength(lines[line - 1], "utf8");
      if (line > startLine && bytes + 1 + lineBytes > budgetBytes) {
        bounded.push({ startLine, endLine: line - 1 });
        startLine = line;
        bytes = 0;
      }
      bytes += (line > startLine ? 1 : 0) + lineBytes;
    }
    bounded.push({ startLine, endLine: range.endLine });
  }
  return bounded;
}

function scoreExcerpt(path: string, content: string, tokens: string[], selection?: ContextSourceSelection, declarationTextWindow = false): { score: number; rankingScore: number; reasons: string[]; lexicalTokenCount: number } {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  const pathReasons = tokens.filter((token) => lowerPath.includes(token));
  const contentReasons = tokens.filter((token) => lowerContent.includes(token));
  const lexicalReasons = [...new Set([...pathReasons, ...contentReasons])].sort();
  const selectionScore = selection?.score ?? 0;
  return {
    lexicalTokenCount: lexicalReasons.length,
    score: pathReasons.reduce((total, token) => total + 6 * countOccurrences(lowerPath, token), 0)
      + contentReasons.reduce((total, token) => total + 2 * countOccurrences(lowerContent, token), 0)
      + selectionScore,
    rankingScore: pathReasons.reduce((total, token) => total + 6 * boundedRankingOccurrences(lowerPath, token), 0)
      + contentReasons.reduce((total, token) => total + 2 * boundedRankingOccurrences(lowerContent, token), 0)
      + selectionScore,
    reasons: [...new Set([
      ...(selection?.reasons ?? []),
      ...(declarationTextWindow ? ["selection:declaration-text-window"] : []),
      ...lexicalReasons,
    ])].slice(0, MAX_REASON_TOKENS),
  };
}

function partitionCandidate(candidate: Candidate, tokens: string[], budgetBytes: number): Candidate[] {
  const lines = candidate.content.split("\n");
  return budgetRanges(lines, [{ startLine: 1, endLine: lines.length }], budgetBytes).map((range) => {
    const content = lines.slice(range.startLine - 1, range.endLine).join("\n");
    return {
      ...candidate,
      startLine: candidate.startLine + range.startLine - 1,
      endLine: candidate.startLine + range.endLine - 1,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      ...scoreExcerpt(candidate.path, content, tokens, candidate.selection, candidate.declarationTextWindow),
    };
  }).sort(candidateSort);
}

function isLegacyExportedDeclaration(line: string): boolean {
  return /^export\s+(?:async\s+)?(?:function|class)\s+[A-Za-z_$][\w$]*/.test(line);
}

function isExtendedExportedDeclaration(line: string): boolean {
  return /^export\s+(?:(?:async\s+)?(?:function|class)\s+[A-Za-z_$][\w$]*|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=)/.test(line);
}

function hasGraphSelection(selection?: ContextSourceSelection): boolean {
  return selection?.reasons.some((reason) => reason.startsWith("graph:dependency:") || reason.startsWith("graph:dependent:")) ?? false;
}

function declarationWindowStart(lines: string[], declarationLine: number, previousDeclarationLine: number): number {
  const lowerBound = Math.max(previousDeclarationLine + 1, declarationLine - DECLARATION_LEADING_COMMENT_LINES);
  for (let line = declarationLine - 1; line >= lowerBound; line -= 1) {
    const trimmed = lines[line - 1].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("/**")) return line;
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    break;
  }
  return declarationLine;
}

function rangeContainsLine(range: { startLine: number; endLine: number }, line: number): boolean {
  return line >= range.startLine && line <= range.endLine;
}

function rangeContainsRange(
  outer: { startLine: number; endLine: number },
  inner: { startLine: number; endLine: number },
): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}

function rangesOverlap(
  left: { startLine: number; endLine: number },
  right: { startLine: number; endLine: number },
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function buildCandidates(source: ContextSource, tokens: string[], budgetBytes: number): Candidate[] {
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

  const lexicalRanges = matchLines.length > 0
    ? mergeRanges(matchLines.map(({ line }) => ({ startLine: Math.max(1, line - WINDOW_RADIUS), endLine: Math.min(lines.length, line + WINDOW_RADIUS) })))
    : [];

  // Preserve the original no-match declaration fallback exactly. The newer
  // lexical-to-declaration expansion is intentionally narrower: it applies only
  // to one-hop graph neighbors, not explicit changed roots or arbitrary hints.
  const legacyDeclarationLines = matchLines.length === 0 && selectionScore > 0
    ? lines.flatMap((line, index) => isLegacyExportedDeclaration(line) ? [index + 1] : [])
    : [];
  const legacyDeclarationRanges = legacyDeclarationLines.map((startLine, index) => ({
    startLine,
    endLine: Math.min(
      lines.length,
      startLine + DECLARATION_WINDOW_LINES - 1,
      (legacyDeclarationLines[index + 1] ?? lines.length + 1) - 1,
    ),
  }));
  const declarationFallback = legacyDeclarationRanges.length > 0;

  const graphDeclarationLines = matchLines.length > 0 && hasGraphSelection(selection)
    ? lines.flatMap((line, index) => isExtendedExportedDeclaration(line) ? [index + 1] : [])
    : [];
  const graphDeclarationRanges = graphDeclarationLines.map((declarationLine, index) => {
    const startLine = declarationWindowStart(lines, declarationLine, graphDeclarationLines[index - 1] ?? 0);
    return {
      startLine,
      endLine: Math.min(
        lines.length,
        startLine + DECLARATION_WINDOW_LINES - 1,
        (graphDeclarationLines[index + 1] ?? lines.length + 1) - 1,
      ),
    };
  });
  const declarationExpansions = graphDeclarationRanges.filter((range) =>
    matchLines.some(({ line }) => rangeContainsLine(range, line))
    && !lexicalRanges.some((lexicalRange) => rangeContainsRange(lexicalRange, range))
  );
  const declarationTextRanges = declarationFallback ? legacyDeclarationRanges : declarationExpansions;

  const ranges = matchLines.length > 0
    ? mergeRanges([...lexicalRanges, ...declarationExpansions])
    : declarationFallback
      ? legacyDeclarationRanges
      : [{ startLine: 1, endLine: Math.min(lines.length, WINDOW_RADIUS * 2 + 1) }];

  return budgetRanges(lines, ranges, budgetBytes).map(({ startLine, endLine }) => {
    const content = lines.slice(startLine - 1, endLine).join("\n");
    const declarationTextWindow = declarationTextRanges.some((range) => rangesOverlap(range, { startLine, endLine }));
    return {
      path: normalizedPath,
      startLine,
      endLine,
      sourceSha256,
      selection,
      declarationTextWindow,
      ...scoreExcerpt(normalizedPath, content, tokens, selection, declarationTextWindow),
      content,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });
}

function candidateSort(left: Candidate, right: Candidate): number {
  return (right.selection?.score ?? 0) - (left.selection?.score ?? 0)
    || right.lexicalTokenCount - left.lexicalTokenCount
    || right.rankingScore - left.rankingScore
    || compareText(left.path, right.path)
    || left.startLine - right.startLine
    || left.endLine - right.endLine;
}

/** Global priority must be reconsidered after splitting: a fragment does not
 * inherit its parent's lexical score. A heap avoids repeatedly sorting or
 * shifting the full candidate array while retaining deterministic tie breaks.
 */
class CandidateQueue {
  private readonly heap: Candidate[] = [];

  get size(): number { return this.heap.length; }

  push(candidate: Candidate): void {
    this.heap.push(candidate);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (candidateSort(this.heap[parent], this.heap[index]) <= 0) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  pop(): Candidate | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      let index = 0;
      while (index * 2 + 1 < this.heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.heap.length && candidateSort(this.heap[child + 1], this.heap[child]) < 0) child += 1;
        if (candidateSort(this.heap[index], this.heap[child]) <= 0) break;
        [this.heap[index], this.heap[child]] = [this.heap[child], this.heap[index]];
        index = child;
      }
    }
    return first;
  }
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
  const candidates = new CandidateQueue();
  for (const source of orderedSources) {
    for (const candidate of buildCandidates(source, tokens, budgetBytes)) candidates.push(candidate);
  }

  let selectedBytes = 0;
  const entries: ContextPackEntry[] = [];
  let omittedCandidates = 0;

  while (candidates.size > 0) {
    const candidate = candidates.pop()!;
    const remainingBytes = budgetBytes - selectedBytes;
    if (candidate.bytes === 0 || remainingBytes === 0) {
      omittedCandidates += 1;
      continue;
    }
    if (candidate.bytes > remainingBytes) {
      // Requeue fitting fragments at their own score before selecting any one
      // of them. An indivisible over-budget line cannot fit any later budget.
      for (const fragment of partitionCandidate(candidate, tokens, remainingBytes)) {
        if (fragment.bytes === 0 || fragment.bytes > remainingBytes) omittedCandidates += 1;
        else candidates.push(fragment);
      }
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
