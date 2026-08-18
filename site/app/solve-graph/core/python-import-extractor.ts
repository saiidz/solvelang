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

export const pythonImportExtractor = Object.freeze({
  id: "python-imports",
  version: "1.0.0",
  deterministic: true as const,
});

export type PythonImportForm = "import" | "from";

export type PythonImportOccurrence = {
  specifier: string;
  form: PythonImportForm;
  line: number;
  column: number;
};

const PYTHON_EXTENSIONS = new Set(["py", "pyi"]);

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

function maskPythonStringsAndComments(source: string): string {
  let output = "";
  let index = 0;
  let state: "single" | "double" | "triple-single" | "triple-double" | "comment" | undefined;

  while (index < source.length) {
    const character = source[index];

    if (state === "comment") {
      if (character === "\n") {
        output += "\n";
        state = undefined;
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (state === "single" || state === "double") {
      const quote = state === "single" ? "'" : '"';
      if (character === "\\" && index + 1 < source.length) {
        output += " ";
        if (source[index + 1] === "\n") output += "\n";
        else output += " ";
        index += 2;
        continue;
      }
      if (character === quote) {
        output += " ";
        state = undefined;
        index += 1;
        continue;
      }
      if (character === "\n") {
        output += "\n";
        state = undefined;
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (state === "triple-single" || state === "triple-double") {
      const delimiter = state === "triple-single" ? "'''" : '\"\"\"';
      if (source.startsWith(delimiter, index)) {
        output += "   ";
        index += 3;
        state = undefined;
        continue;
      }
      if (character === "\\" && index + 1 < source.length) {
        output += " ";
        if (source[index + 1] === "\n") output += "\n";
        else output += " ";
        index += 2;
        continue;
      }
      output += character === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (character === "#") {
      output += " ";
      state = "comment";
      index += 1;
      continue;
    }
    if (source.startsWith("'''", index)) {
      output += "   ";
      state = "triple-single";
      index += 3;
      continue;
    }
    if (source.startsWith('\"\"\"', index)) {
      output += "   ";
      state = "triple-double";
      index += 3;
      continue;
    }
    if (character === "'") {
      output += " ";
      state = "single";
      index += 1;
      continue;
    }
    if (character === '"') {
      output += " ";
      state = "double";
      index += 1;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function validModuleSpecifier(value: string): boolean {
  return /^(?:\.+(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.test(value);
}

export function scanPythonImportSpecifiers(source: string): PythonImportOccurrence[] {
  if (typeof source !== "string") throw new Error("Python import source must be text.");
  const maskedLines = maskPythonStringsAndComments(source).split(/\r?\n/);
  const found: PythonImportOccurrence[] = [];

  for (let lineIndex = 0; lineIndex < maskedLines.length; lineIndex += 1) {
    const line = maskedLines[lineIndex];
    const fromMatch = /^([ \t]*)from[ \t]+(\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|\.+)[ \t]+import\b/.exec(line);
    if (fromMatch) {
      const specifier = fromMatch[2].normalize("NFC");
      if (validModuleSpecifier(specifier)) {
        found.push({
          specifier,
          form: "from",
          line: lineIndex + 1,
          column: fromMatch[1].length + 1,
        });
      }
      continue;
    }

    const importMatch = /^([ \t]*)import[ \t]+([^;]+)/.exec(line);
    if (!importMatch) continue;
    for (const rawPart of importMatch[2].split(",")) {
      const moduleName = rawPart
        .replace(/[ \t]+as[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*$/, "")
        .trim()
        .normalize("NFC");
      if (!validModuleSpecifier(moduleName) || moduleName.startsWith(".")) continue;
      found.push({
        specifier: moduleName,
        form: "import",
        line: lineIndex + 1,
        column: importMatch[1].length + 1,
      });
    }
  }

  return found.sort((left, right) =>
    left.line - right.line
    || left.column - right.column
    || compareText(left.form, right.form)
    || compareText(left.specifier, right.specifier));
}

function pythonResolutionCandidates(importerPath: string, specifier: string): string[] {
  const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 0;
  const moduleName = leadingDots > 0 ? specifier.slice(leadingDots) : specifier;
  let segments: string[];

  if (leadingDots > 0) {
    segments = dirname(importerPath).split("/").filter(Boolean);
    if (segments.length === 0) return [];
    const parents = leadingDots - 1;
    if (parents >= segments.length) return [];
    if (parents > 0) segments = segments.slice(0, segments.length - parents);
  } else {
    segments = [];
  }

  if (moduleName) segments.push(...moduleName.split("."));
  if (segments.length === 0) return [];
  const root = normalizeSolveGraphPath(segments.join("/"));

  if (leadingDots > 0 && !moduleName) {
    return [`${root}/__init__.py`, `${root}/__init__.pyi`];
  }
  return [
    `${root}.py`,
    `${root}.pyi`,
    `${root}/__init__.py`,
    `${root}/__init__.pyi`,
  ];
}

function filePathFromNode(node: SolveGraphNode): string | undefined {
  const value = node.metadata?.path;
  return node.kind === "file" && typeof value === "string" ? value : undefined;
}

type PendingPythonRelation = {
  from: string;
  target: string;
  form: PythonImportForm;
  specifier: string;
  evidence: Array<{ kind: "deterministic-analysis"; path: string; line: number; column: number; note: string }>;
};

function relationKey(from: string, target: string, form: PythonImportForm, specifier: string): string {
  return `${from}\u001f${target}\u001f${form}\u001f${specifier}`;
}

export async function augmentSolveGraphWithPythonImports(
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
  const pending = new Map<string, PendingPythonRelation>();

  for (const importerPath of [...filesByPath.keys()].sort(compareText)) {
    if (!PYTHON_EXTENSIONS.has(extension(importerPath))) continue;
    const sourceFile = sourceByPath.get(importerPath);
    if (!sourceFile || typeof sourceFile.text !== "string") continue;
    const importer = filesByPath.get(importerPath)!;

    for (const item of scanPythonImportSpecifiers(sourceFile.text)) {
      const localTarget = pythonResolutionCandidates(importerPath, item.specifier)
        .map((candidate) => filesByPath.get(candidate))
        .find(Boolean);
      if (!localTarget || localTarget.id === importer.id) continue;
      const key = relationKey(importer.id, localTarget.id, item.form, item.specifier);
      const evidence = {
        kind: "deterministic-analysis" as const,
        path: importerPath,
        line: item.line,
        column: item.column,
        note: `python ${item.form} ${item.specifier}`,
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
      qualifier: `python:${relation.form}:${relation.specifier}`,
      evidence,
      metadata: {
        language: "python",
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
    extractors: [...inventory.extractors, pythonImportExtractor],
    limits,
    status: reasons.length === 0 ? "complete" : "partial",
    truncationReasons: reasons,
    nodes,
    edges,
  });
}
