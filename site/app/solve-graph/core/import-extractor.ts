import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import type {
  SolveGraphDocument,
  SolveGraphEdge,
  SolveGraphNode,
  SolveGraphScanLimits,
  SolveGraphTruncationReason,
} from "./contracts";
import {
  extractRepositoryInventoryGraph,
  type ExtractRepositoryInventoryGraphOptions,
} from "./inventory-extractor";
import { normalizeSolveGraphPath } from "./limits";

export const javaScriptImportExtractor = Object.freeze({
  id: "javascript-imports",
  version: "1.0.0",
  deterministic: true as const,
});

export type JavaScriptImportForm = "static" | "export" | "dynamic" | "require";

export type JavaScriptImportOccurrence = {
  specifier: string;
  form: JavaScriptImportForm;
  line: number;
  column: number;
};

export type ExtractRepositoryDependencyGraphOptions = ExtractRepositoryInventoryGraphOptions;

const JAVA_SCRIPT_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const MAX_IMPORT_SCAN_AHEAD = 16_384;

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

function identifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function tokenAt(source: string, index: number, token: string): boolean {
  if (!source.startsWith(token, index)) return false;
  return !identifierCharacter(source[index - 1]) && !identifierCharacter(source[index + token.length]);
}

function skipLineComment(source: string, index: number): number {
  let cursor = index + 2;
  while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
  return cursor;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end < 0 ? source.length : end + 2;
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipWhitespaceAndComments(source: string, index: number): number {
  let cursor = index;
  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source.startsWith("//", cursor)) {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    return cursor;
  }
}

function parseStringLiteral(source: string, index: number): { value: string; end: number } | undefined {
  const quote = source[index];
  if (quote !== "\"" && quote !== "'") return undefined;
  let cursor = index + 1;
  let value = "";
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") return undefined;
    if (character === quote) return { value, end: cursor + 1 };
    if (character === "\n" || character === "\r" || character === "\0") return undefined;
    value += character;
    cursor += 1;
  }
  return undefined;
}

function location(source: string, index: number): Pick<JavaScriptImportOccurrence, "line" | "column"> {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function occurrence(source: string, index: number, form: JavaScriptImportForm, specifier: string): JavaScriptImportOccurrence | undefined {
  const normalized = specifier.normalize("NFC").trim();
  if (!normalized || normalized.length > 2_048 || normalized.includes("\0")) return undefined;
  return { specifier: normalized, form, ...location(source, index) };
}

function directStringAfter(source: string, index: number): { value: string; end: number } | undefined {
  const cursor = skipWhitespaceAndComments(source, index);
  return parseStringLiteral(source, cursor);
}

function callStringAfter(source: string, index: number): { value: string; end: number } | undefined {
  let cursor = skipWhitespaceAndComments(source, index);
  if (source[cursor] !== "(") return undefined;
  cursor = skipWhitespaceAndComments(source, cursor + 1);
  const literal = parseStringLiteral(source, cursor);
  if (!literal) return undefined;
  cursor = skipWhitespaceAndComments(source, literal.end);
  return source[cursor] === ")" ? literal : undefined;
}

function fromStringAfter(source: string, index: number): { value: string; end: number } | undefined {
  const boundary = Math.min(source.length, index + MAX_IMPORT_SCAN_AHEAD);
  let cursor = index;
  while (cursor < boundary) {
    if (source.startsWith("//", cursor)) {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    const character = source[cursor];
    if (character === "\"" || character === "'" || character === "`") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (character === ";") return undefined;
    if (tokenAt(source, cursor, "from")) return directStringAfter(source, cursor + 4);
    cursor += 1;
  }
  return undefined;
}

export function scanJavaScriptImportSpecifiers(source: string): JavaScriptImportOccurrence[] {
  if (typeof source !== "string") throw new Error("JavaScript import source must be text.");
  const found: JavaScriptImportOccurrence[] = [];

  for (let index = 0; index < source.length;) {
    if (source.startsWith("//", index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith("/*", index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
      index = skipQuoted(source, index);
      continue;
    }

    if (tokenAt(source, index, "import")) {
      const after = skipWhitespaceAndComments(source, index + 6);
      let literal: { value: string; end: number } | undefined;
      let form: JavaScriptImportForm = "static";
      if (source[after] === ".") {
        index += 6;
        continue;
      }
      if (source[after] === "(") {
        literal = callStringAfter(source, index + 6);
        form = "dynamic";
      } else {
        literal = parseStringLiteral(source, after) ?? fromStringAfter(source, index + 6);
      }
      if (literal) {
        const item = occurrence(source, index, form, literal.value);
        if (item) found.push(item);
      }
      index += 6;
      continue;
    }

    if (tokenAt(source, index, "export")) {
      const literal = fromStringAfter(source, index + 6);
      if (literal) {
        const item = occurrence(source, index, "export", literal.value);
        if (item) found.push(item);
      }
      index += 6;
      continue;
    }

    if (tokenAt(source, index, "require")) {
      const literal = callStringAfter(source, index + 7);
      if (literal) {
        const item = occurrence(source, index, "require", literal.value);
        if (item) found.push(item);
      }
      index += 7;
      continue;
    }

    index += 1;
  }

  return found.sort((left, right) => left.line - right.line || left.column - right.column || compareText(left.form, right.form) || compareText(left.specifier, right.specifier));
}

function normalizeRelativeTarget(importerPath: string, specifier: string): string | undefined {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  if (!cleanSpecifier.startsWith(".")) return undefined;
  const segments = dirname(importerPath).split("/").filter(Boolean);
  for (const part of cleanSpecifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  if (segments.length === 0) return undefined;
  return normalizeSolveGraphPath(segments.join("/"));
}

function resolutionCandidates(importerPath: string, specifier: string): string[] {
  const target = normalizeRelativeTarget(importerPath, specifier);
  if (!target) return [];
  const candidates = [target];
  const lower = target.toLowerCase();
  const suffix = lower.slice(lower.lastIndexOf("."));
  if (suffix === ".js" || suffix === ".jsx" || suffix === ".mjs" || suffix === ".cjs") {
    const stem = target.slice(0, target.length - suffix.length);
    for (const extensionValue of RESOLUTION_EXTENSIONS) candidates.push(`${stem}${extensionValue}`);
  }
  if (!/\.[^/]+$/.test(target)) {
    for (const extensionValue of RESOLUTION_EXTENSIONS) candidates.push(`${target}${extensionValue}`);
    for (const extensionValue of RESOLUTION_EXTENSIONS) candidates.push(`${target}/index${extensionValue}`);
  }
  return [...new Set(candidates)];
}

function packageRoot(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2 || parts[0].length < 2 || !parts[1]) return undefined;
    return `${parts[0]}/${parts[1]}`;
  }
  const root = specifier.split("/", 1)[0];
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(root) ? root : undefined;
}

function declaredPackageDependencies(snapshot: RepositorySnapshot): Map<string, string> {
  const manifests = new Map<string, string>();
  for (const file of [...snapshot.files].sort((left, right) => compareText(left.path, right.path))) {
    const path = normalizeSolveGraphPath(file.path);
    if (basename(path).toLowerCase() !== "package.json" || typeof file.text !== "string") continue;
    try {
      const parsed = JSON.parse(file.text) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const values = parsed[field];
        if (!values || typeof values !== "object" || Array.isArray(values)) continue;
        for (const name of Object.keys(values as Record<string, unknown>).sort(compareText)) {
          if (!manifests.has(name)) manifests.set(name, path);
        }
      }
    } catch {
      // Repository Audit treats malformed manifests as data, not executable configuration.
    }
  }
  return manifests;
}

function relationKey(from: string, target: string, form: JavaScriptImportForm, specifier: string): string {
  return `${from}\u001f${target}\u001f${form}\u001f${specifier}`;
}

type PendingRelation = {
  from: string;
  localTargetId?: string;
  dependencyName?: string;
  form: JavaScriptImportForm;
  specifier: string;
  evidence: Array<{ kind: "deterministic-analysis"; path: string; line: number; column: number; note: string }>;
};

function filePathFromNode(node: SolveGraphNode): string | undefined {
  const value = node.metadata?.path;
  return node.kind === "file" && typeof value === "string" ? value : undefined;
}

async function augmentWithJavaScriptImports(
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
  const declaredDependencies = declaredPackageDependencies(snapshot);
  const pending = new Map<string, PendingRelation>();

  for (const importerPath of [...filesByPath.keys()].sort(compareText)) {
    if (!JAVA_SCRIPT_EXTENSIONS.has(extension(importerPath))) continue;
    const sourceFile = sourceByPath.get(importerPath);
    if (!sourceFile || typeof sourceFile.text !== "string") continue;
    const importer = filesByPath.get(importerPath)!;

    for (const item of scanJavaScriptImportSpecifiers(sourceFile.text)) {
      const localTarget = resolutionCandidates(importerPath, item.specifier)
        .map((candidate) => filesByPath.get(candidate))
        .find(Boolean);
      let dependencyName: string | undefined;
      if (!localTarget && !item.specifier.startsWith(".")) {
        const root = packageRoot(item.specifier);
        if (root?.startsWith("node:")) dependencyName = root;
        else if (root && declaredDependencies.has(root)) dependencyName = root;
      }
      if (!localTarget && !dependencyName) continue;

      const targetIdentity = localTarget ? localTarget.id : `dependency:${dependencyName}`;
      const key = relationKey(importer.id, targetIdentity, item.form, item.specifier);
      const evidence = {
        kind: "deterministic-analysis" as const,
        path: importerPath,
        line: item.line,
        column: item.column,
        note: `${item.form} import ${item.specifier}`,
      };
      const existing = pending.get(key);
      if (existing) existing.evidence.push(evidence);
      else pending.set(key, {
        from: importer.id,
        ...(localTarget ? { localTargetId: localTarget.id } : { dependencyName }),
        form: item.form,
        specifier: item.specifier,
        evidence: [evidence],
      });
    }
  }

  const dependencyNodeIds = new Map<string, string>();
  const requiredDependencies = [...new Set([...pending.values()].map((item) => item.dependencyName).filter((value): value is string => Boolean(value)))].sort(compareText);
  for (const dependencyName of requiredDependencies) {
    if (nodes.length >= limits.maxNodes) {
      truncationReasons.add("node-count");
      continue;
    }
    const manifestPath = dependencyName.startsWith("node:") ? undefined : declaredDependencies.get(dependencyName);
    const dependency = await createSolveGraphNode({
      kind: "dependency",
      identity: dependencyName.startsWith("node:") ? `dependency:node:${dependencyName}` : `dependency:npm:${dependencyName}`,
      label: dependencyName,
      evidence: manifestPath ? [{ kind: "manifest", path: manifestPath, note: `declares ${dependencyName}` }] : [],
      metadata: {
        ecosystem: dependencyName.startsWith("node:") ? "node-builtin" : "npm",
        packageName: dependencyName,
      },
    }, limits);
    nodes.push(dependency);
    dependencyNodeIds.set(dependencyName, dependency.id);
  }

  for (const [, relation] of [...pending.entries()].sort(([left], [right]) => compareText(left, right))) {
    const targetId = relation.localTargetId ?? (relation.dependencyName ? dependencyNodeIds.get(relation.dependencyName) : undefined);
    if (!targetId) continue;
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
      to: targetId,
      qualifier: `${relation.form}:${relation.specifier}`,
      evidence,
      metadata: {
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
    extractors: [...inventory.extractors, javaScriptImportExtractor],
    limits,
    status: reasons.length === 0 ? "complete" : "partial",
    truncationReasons: reasons,
    nodes,
    edges,
  });
}

export async function extractRepositoryDependencyGraph(
  snapshot: RepositorySnapshot,
  options: ExtractRepositoryDependencyGraphOptions = {},
): Promise<SolveGraphDocument> {
  const inventory = await extractRepositoryInventoryGraph(snapshot, options);
  return augmentWithJavaScriptImports(inventory, snapshot);
}
