import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
} from "./canonical";
import type {
  SolveGraphDocument,
  SolveGraphEdge,
  SolveGraphNode,
  SolveGraphScanLimits,
  SolveGraphTruncationReason,
} from "./contracts";
import { normalizeSolveGraphPath } from "./limits";

export const phpImportExtractor = Object.freeze({
  id: "php-local-imports",
  version: "1.0.0",
  deterministic: true as const,
});

export type PhpLocalImportForm = "require" | "require_once" | "include" | "include_once";

export type PhpLocalImportOccurrence = {
  specifier: string;
  form: PhpLocalImportForm;
  line: number;
  column: number;
};

const PHP_EXTENSIONS = new Set(["php", "phtml"]);
const PHP_IMPORT_FORMS = ["require_once", "include_once", "require", "include"] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

function lineColumnAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function skipQuotedString(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function parseLiteralImport(
  source: string,
  keywordOffset: number,
  form: PhpLocalImportForm,
): { occurrence?: PhpLocalImportOccurrence; next: number } {
  let index = keywordOffset + form.length;
  index = skipWhitespace(source, index);
  let parenthesized = false;
  if (source[index] === "(") {
    parenthesized = true;
    index = skipWhitespace(source, index + 1);
  }
  const quote = source[index];
  if (quote !== "'" && quote !== '"') return { next: keywordOffset + form.length };
  const literalStart = index + 1;
  index = literalStart;
  let escaped = false;
  while (index < source.length && source[index] !== quote) {
    if (source[index] === "\\") {
      escaped = true;
      index += 2;
      continue;
    }
    index += 1;
  }
  if (index >= source.length) return { next: source.length };
  const rawSpecifier = source.slice(literalStart, index).normalize("NFC");
  index = skipWhitespace(source, index + 1);
  if (parenthesized) {
    if (source[index] !== ")") return { next: index };
    index = skipWhitespace(source, index + 1);
  }
  if (source[index] !== ";") return { next: index };
  const explicitRelative = rawSpecifier.startsWith("./") || rawSpecifier.startsWith("../");
  const safeLiteral = !escaped
    && explicitRelative
    && !rawSpecifier.includes("\\")
    && !rawSpecifier.includes("\0")
    && !rawSpecifier.includes("$");
  if (!safeLiteral) return { next: index + 1 };
  const location = lineColumnAt(source, keywordOffset);
  return {
    occurrence: {
      specifier: rawSpecifier,
      form,
      line: location.line,
      column: location.column,
    },
    next: index + 1,
  };
}

export function scanPhpLocalImportSpecifiers(source: string): PhpLocalImportOccurrence[] {
  if (typeof source !== "string") throw new Error("PHP import source must be text.");
  const found: PhpLocalImportOccurrence[] = [];
  let index = 0;
  let inPhp = false;

  while (index < source.length) {
    if (!inPhp) {
      const open = source.indexOf("<?", index);
      if (open < 0) break;
      if (source.startsWith("<?xml", open)) {
        index = open + 2;
        continue;
      }
      inPhp = true;
      index = source.startsWith("<?php", open) ? open + 5 : open + 2;
      continue;
    }

    if (source.startsWith("?>", index)) {
      inPhp = false;
      index += 2;
      continue;
    }
    if (source.startsWith("//", index) || source[index] === "#") {
      const newline = source.indexOf("\n", index + 1);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source[index] === "'" || source[index] === '"') {
      index = skipQuotedString(source, index);
      continue;
    }

    let matched = false;
    for (const form of PHP_IMPORT_FORMS) {
      if (!source.startsWith(form, index)) continue;
      if (isWordCharacter(source[index - 1]) || isWordCharacter(source[index + form.length])) continue;
      const parsed = parseLiteralImport(source, index, form);
      if (parsed.occurrence) found.push(parsed.occurrence);
      index = Math.max(index + 1, parsed.next);
      matched = true;
      break;
    }
    if (!matched) index += 1;
  }

  return found.sort((left, right) =>
    left.line - right.line
    || left.column - right.column
    || compareText(left.form, right.form)
    || compareText(left.specifier, right.specifier));
}

function resolveExplicitRelativePath(importerPath: string, specifier: string): string | undefined {
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) return undefined;
  const segments = dirname(importerPath).split("/").filter(Boolean);
  for (const segment of specifier.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  try {
    return normalizeSolveGraphPath(segments.join("/"));
  } catch {
    return undefined;
  }
}

function filePathFromNode(node: SolveGraphNode): string | undefined {
  const value = node.metadata?.path;
  return node.kind === "file" && typeof value === "string" ? value : undefined;
}

type PendingPhpRelation = {
  from: string;
  target: string;
  form: PhpLocalImportForm;
  specifier: string;
  evidence: Array<{ kind: "deterministic-analysis"; path: string; line: number; column: number; note: string }>;
};

function relationKey(from: string, target: string, form: PhpLocalImportForm, specifier: string): string {
  return `${from}\u001f${target}\u001f${form}\u001f${specifier}`;
}

export async function augmentSolveGraphWithPhpLocalImports(
  inventory: SolveGraphDocument,
  snapshot: RepositorySnapshot,
): Promise<SolveGraphDocument> {
  const limits: SolveGraphScanLimits = inventory.limits;
  const nodes = [...inventory.nodes];
  const edges = [...inventory.edges];
  const truncationReasons = new Set<SolveGraphTruncationReason>(inventory.execution.truncationReasons);
  const filesByPath = new Map<string, SolveGraphNode>();
  for (const node of inventory.nodes) {
    const path = filePathFromNode(node);
    if (path) filesByPath.set(path, node);
  }
  const sourceByPath = new Map(snapshot.files.map((file) => [normalizeSolveGraphPath(file.path), file]));
  const pending = new Map<string, PendingPhpRelation>();

  for (const importerPath of [...filesByPath.keys()].sort(compareText)) {
    if (!PHP_EXTENSIONS.has(extension(importerPath))) continue;
    const sourceFile = sourceByPath.get(importerPath);
    if (!sourceFile || typeof sourceFile.text !== "string") continue;
    const importer = filesByPath.get(importerPath)!;

    for (const item of scanPhpLocalImportSpecifiers(sourceFile.text)) {
      const targetPath = resolveExplicitRelativePath(importerPath, item.specifier);
      if (!targetPath) continue;
      const localTarget = filesByPath.get(targetPath);
      if (!localTarget || localTarget.id === importer.id) continue;
      const key = relationKey(importer.id, localTarget.id, item.form, item.specifier);
      const evidence = {
        kind: "deterministic-analysis" as const,
        path: importerPath,
        line: item.line,
        column: item.column,
        note: `php ${item.form} ${item.specifier}`,
      };
      const existing = pending.get(key);
      if (existing) existing.evidence.push(evidence);
      else pending.set(key, {
        from: importer.id,
        target: localTarget.id,
        form: item.form,
        specifier: item.specifier,
        evidence: [evidence],
      });
    }
  }

  for (const [, relation] of [...pending.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (edges.length >= limits.maxEdges) {
      truncationReasons.add("edge-count");
      break;
    }
    const orderedEvidence = [...relation.evidence]
      .sort((left, right) => left.line - right.line || left.column - right.column || compareText(left.note, right.note));
    const evidence = orderedEvidence.slice(0, limits.maxEvidencePerElement);
    if (evidence.length < orderedEvidence.length) truncationReasons.add("evidence-count");
    const edge: SolveGraphEdge = await createSolveGraphEdge({
      kind: "imports",
      from: relation.from,
      to: relation.target,
      qualifier: `php:${relation.form}:${relation.specifier}`,
      evidence,
      metadata: {
        language: "php",
        importForm: relation.form,
        specifier: relation.specifier,
        occurrenceCount: orderedEvidence.length,
      },
    }, limits);
    edges.push(edge);
  }

  const reasons = [...truncationReasons].sort(compareText);
  return createSolveGraphDocument({
    source: inventory.source,
    engineVersion: inventory.engine.version,
    extractors: [...inventory.extractors, phpImportExtractor],
    limits,
    status: reasons.length === 0 ? "complete" : "partial",
    truncationReasons: reasons,
    nodes,
    edges,
  });
}
