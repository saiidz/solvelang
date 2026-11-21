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

export const bladeDirectiveExtractor = Object.freeze({
  id: "blade-view-directives",
  version: "1.0.0",
  deterministic: true as const,
});

export type BladeDirectiveForm =
  | "include"
  | "includeIf"
  | "includeWhen"
  | "includeUnless"
  | "includeFirst"
  | "extends"
  | "component"
  | "component-tag";

export type BladeViewReference = {
  /** Candidate view names, in resolution order. The first that resolves wins. */
  names: string[];
  form: BladeDirectiveForm;
  /** The view name or tag name exactly as written in the source. */
  specifier: string;
  line: number;
  column: number;
};

const DIRECTIVE_NAMES = [
  "includeUnless",
  "includeWhen",
  "includeFirst",
  "includeIf",
  "include",
  "extends",
  "component",
] as const;

type DirectiveName = typeof DIRECTIVE_NAMES[number];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function isBladePath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(".blade.php");
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
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

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

/** Reads a quoted string starting at `start`; returns its literal value or undefined. */
function readStringLiteral(
  source: string,
  start: number,
): { value: string; next: number } | undefined {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return undefined;
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      value += source[index + 1];
      index += 2;
      continue;
    }
    if (char === quote) return { value: value.normalize("NFC"), next: index + 1 };
    // A double-quoted name carrying interpolation is dynamic, not a literal view name.
    if (quote === '"' && char === "$") return undefined;
    value += char;
    index += 1;
  }
  return undefined;
}

/**
 * Scans a balanced parenthesised argument list starting at the opening paren.
 * Returns the top-level argument spans (offsets into source) and the index
 * just past the closing paren, or undefined when unbalanced.
 */
function scanArgumentList(
  source: string,
  openParen: number,
): { args: Array<{ start: number; end: number }>; next: number } | undefined {
  const args: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let argStart = openParen + 1;
  let index = openParen;
  while (index < source.length) {
    const char = source[index];
    if (char === "'" || char === '"') {
      const literal = readStringLiteralRaw(source, index);
      index = literal;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        if (char !== ")") return undefined;
        args.push({ start: argStart, end: index });
        return { args, next: index + 1 };
      }
      index += 1;
      continue;
    }
    if (char === "," && depth === 1) {
      args.push({ start: argStart, end: index });
      argStart = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return undefined;
}

/** Skips a quoted string without interpreting it; returns the index past it. */
function readStringLiteralRaw(source: string, start: number): number {
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

/** Extracts the string literal that an argument span consists of, if it is one. */
function argumentStringLiteral(
  source: string,
  span: { start: number; end: number },
): string | undefined {
  const start = skipWhitespace(source, span.start);
  if (start >= span.end) return undefined;
  const literal = readStringLiteral(source, start);
  if (!literal) return undefined;
  // The argument must be exactly the literal (nothing but whitespace after it).
  if (skipWhitespace(source, literal.next) < span.end) return undefined;
  return literal.value;
}

/** Extracts every string literal inside an array-literal argument span, in order. */
function argumentArrayStringLiterals(
  source: string,
  span: { start: number; end: number },
): string[] | undefined {
  const start = skipWhitespace(source, span.start);
  if (source[start] !== "[") return undefined;
  const values: string[] = [];
  let index = start + 1;
  while (index < span.end) {
    const char = source[index];
    if (char === "'" || char === '"') {
      const literal = readStringLiteral(source, index);
      if (!literal) return undefined;
      values.push(literal.value);
      index = literal.next;
      continue;
    }
    if (char === "]") break;
    index += 1;
  }
  return values;
}

function parseDirectiveReference(
  source: string,
  atOffset: number,
  name: DirectiveName,
): { reference?: BladeViewReference; next: number } {
  let index = skipWhitespace(source, atOffset + 1 + name.length);
  if (source[index] !== "(") return { next: atOffset + 1 + name.length };
  const scanned = scanArgumentList(source, index);
  if (!scanned) return { next: source.length };
  const location = lineColumnAt(source, atOffset);
  const base = { form: name as BladeDirectiveForm, line: location.line, column: location.column };

  if (name === "includeFirst") {
    const names = scanned.args.length > 0
      ? argumentArrayStringLiterals(source, scanned.args[0])
      : undefined;
    if (!names || names.length === 0) return { next: scanned.next };
    return {
      reference: { ...base, names, specifier: names[0] },
      next: scanned.next,
    };
  }

  if (name === "includeWhen" || name === "includeUnless") {
    // The view name is the second argument; the first is the condition.
    const viewName = scanned.args.length > 1
      ? argumentStringLiteral(source, scanned.args[1])
      : undefined;
    if (!viewName) return { next: scanned.next };
    return {
      reference: { ...base, names: [viewName], specifier: viewName },
      next: scanned.next,
    };
  }

  const viewName = scanned.args.length > 0
    ? argumentStringLiteral(source, scanned.args[0])
    : undefined;
  if (!viewName) return { next: scanned.next };
  return {
    reference: { ...base, names: [viewName], specifier: viewName },
    next: scanned.next,
  };
}

/** StudlyCase form of a kebab-case segment: `foo-bar` -> `FooBar`. */
function studly(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function parseComponentTagReference(
  source: string,
  ltOffset: number,
): { reference?: BladeViewReference; next: number } {
  // source starts with "<x-" at ltOffset. Read the tag name.
  let index = ltOffset + 3;
  const nameStart = index;
  while (index < source.length && /[A-Za-z0-9._-]/.test(source[index])) index += 1;
  const tag = source.slice(nameStart, index);
  if (!tag || tag === "slot" || tag.startsWith("slot:") || tag === "dynamic-component") {
    return { next: index };
  }
  const segments = tag.split(".");
  const studlyTag = [...segments.slice(0, -1), studly(segments[segments.length - 1])].join(".");
  const names = studlyTag === tag
    ? [`components.${tag}`]
    : [`components.${tag}`, `components.${studlyTag}`];
  const location = lineColumnAt(source, ltOffset);
  return {
    reference: {
      names,
      form: "component-tag",
      specifier: tag,
      line: location.line,
      column: location.column,
    },
    next: index,
  };
}

export function scanBladeViewReferences(source: string): BladeViewReference[] {
  if (typeof source !== "string") throw new Error("Blade source must be text.");
  const found: BladeViewReference[] = [];
  let index = 0;

  while (index < source.length) {
    // Blade comments carry no directives.
    if (source.startsWith("{{--", index)) {
      const end = source.indexOf("--}}", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    // Verbatim blocks are literal text.
    if (source.startsWith("@verbatim", index) && !isWordCharacter(source[index + 9])) {
      const end = source.indexOf("@endverbatim", index + 9);
      index = end < 0 ? source.length : end + "@endverbatim".length;
      continue;
    }
    if (source.startsWith("<x-", index)) {
      const parsed = parseComponentTagReference(source, index);
      if (parsed.reference) found.push(parsed.reference);
      index = Math.max(index + 1, parsed.next);
      continue;
    }
    if (source[index] === "@") {
      // A directive never directly follows a word character (email-like text).
      if (isWordCharacter(source[index - 1])) {
        index += 1;
        continue;
      }
      // An escaped directive (@@include) renders literally.
      if (source[index + 1] === "@") {
        index += 2;
        continue;
      }
      let matched = false;
      for (const name of DIRECTIVE_NAMES) {
        if (!source.startsWith(name, index + 1)) continue;
        if (isWordCharacter(source[index + 1 + name.length])) continue;
        const parsed = parseDirectiveReference(source, index, name);
        if (parsed.reference) found.push(parsed.reference);
        index = Math.max(index + 1, parsed.next);
        matched = true;
        break;
      }
      if (!matched) index += 1;
      continue;
    }
    index += 1;
  }

  return found.sort((left, right) =>
    left.line - right.line
    || left.column - right.column
    || compareText(left.form, right.form)
    || compareText(left.specifier, right.specifier));
}

/**
 * Discovers the views roots: every ancestor directory named `views` that
 * holds at least one Blade file beneath it, in deterministic order.
 */
export function discoverBladeViewsRoots(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    if (!isBladePath(path)) continue;
    const segments = path.split("/");
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index] === "views") {
        roots.add(segments.slice(0, index + 1).join("/"));
      }
    }
  }
  return [...roots].sort(compareText);
}

/** Resolves a dotted Laravel view name against the views roots. */
export function resolveBladeViewPath(
  viewName: string,
  viewsRoots: readonly string[],
  existingPaths: ReadonlySet<string>,
): string | undefined {
  const relative = `${viewName.replace(/\./g, "/")}.blade.php`;
  for (const root of viewsRoots) {
    const candidate = `${root}/${relative}`;
    try {
      const normalized = normalizeSolveGraphPath(candidate);
      if (existingPaths.has(normalized)) return normalized;
    } catch {
      continue;
    }
  }
  return undefined;
}

function filePathFromNode(node: SolveGraphNode): string | undefined {
  const value = node.metadata?.path;
  return node.kind === "file" && typeof value === "string" ? value : undefined;
}

type PendingBladeRelation = {
  from: string;
  target: string;
  form: BladeDirectiveForm;
  specifier: string;
  viewName: string;
  evidence: Array<{ kind: "deterministic-analysis"; path: string; line: number; column: number; note: string }>;
};

function relationKey(from: string, target: string, form: BladeDirectiveForm, specifier: string): string {
  return `${from}\u001f${target}\u001f${form}\u001f${specifier}`;
}

export async function augmentSolveGraphWithBladeDirectives(
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
  const existingPaths = new Set(filesByPath.keys());
  const viewsRoots = discoverBladeViewsRoots([...existingPaths]);
  const sourceByPath = new Map(snapshot.files.map((file) => [normalizeSolveGraphPath(file.path), file]));
  const pending = new Map<string, PendingBladeRelation>();

  if (viewsRoots.length > 0) {
    for (const importerPath of [...filesByPath.keys()].sort(compareText)) {
      if (!isBladePath(importerPath)) continue;
      const sourceFile = sourceByPath.get(importerPath);
      if (!sourceFile || typeof sourceFile.text !== "string") continue;
      const importer = filesByPath.get(importerPath)!;

      for (const item of scanBladeViewReferences(sourceFile.text)) {
        let resolvedName: string | undefined;
        let targetPath: string | undefined;
        for (const candidateName of item.names) {
          const resolved = resolveBladeViewPath(candidateName, viewsRoots, existingPaths);
          if (resolved) {
            resolvedName = candidateName;
            targetPath = resolved;
            break;
          }
        }
        if (!targetPath || !resolvedName) continue;
        const localTarget = filesByPath.get(targetPath);
        if (!localTarget || localTarget.id === importer.id) continue;
        const key = relationKey(importer.id, localTarget.id, item.form, resolvedName);
        const evidence = {
          kind: "deterministic-analysis" as const,
          path: importerPath,
          line: item.line,
          column: item.column,
          note: item.form === "component-tag"
            ? `blade <x-${item.specifier}> ${resolvedName}`
            : `blade @${item.form} ${item.specifier}`,
        };
        const existing = pending.get(key);
        if (existing) existing.evidence.push(evidence);
        else pending.set(key, {
          from: importer.id,
          target: localTarget.id,
          form: item.form,
          specifier: item.specifier,
          viewName: resolvedName,
          evidence: [evidence],
        });
      }
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
      qualifier: `blade:${relation.form}:${relation.viewName}`,
      evidence,
      metadata: {
        language: "blade",
        directive: relation.form,
        specifier: relation.specifier,
        viewName: relation.viewName,
        occurrenceCount: orderedEvidence.length,
      },
    }, limits);
    edges.push(edge);
  }

  const reasons = [...truncationReasons].sort(compareText);
  return createSolveGraphDocument({
    source: inventory.source,
    engineVersion: inventory.engine.version,
    extractors: [...inventory.extractors, bladeDirectiveExtractor],
    limits,
    status: reasons.length === 0 ? "complete" : "partial",
    truncationReasons: reasons,
    nodes,
    edges,
  });
}
