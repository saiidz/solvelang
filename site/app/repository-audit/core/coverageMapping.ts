import type { SolveGraphDocument } from "../../solve-graph/core/contracts";
import {
  normalizeRepositoryPath,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryTestCoverageMapping = {
  testPath: string;
  targetPath: string;
  importEdgeCount: number;
};

export type RepositoryDocumentationMapping = {
  documentPath: string;
  targetPath: string;
  linkCount: number;
  firstLine: number;
};

export type RepositoryCoverageMap = {
  schema: "solvelang.repository-audit.coverage-map.v0";
  mode: "analyze-only";
  summary: {
    sourceFiles: number;
    testFiles: number;
    documentationFiles: number;
    directlyTestedSourceFiles: number;
    documentationLinkedSourceFiles: number;
  };
  testMappings: RepositoryTestCoverageMapping[];
  documentationMappings: RepositoryDocumentationMapping[];
  sourceFilesWithoutDirectTestImport: string[];
  sourceFilesWithoutDocumentationLink: string[];
  execution: {
    status: "complete" | "partial";
    graphTruncated: boolean;
    mappingsTruncated: boolean;
    samplesTruncated: boolean;
    maxMappings: number;
    maxUnmappedSamples: number;
    networkAccess: false;
    writeAccess: false;
  };
};

export type RepositoryCoverageMapOptions = {
  maxMappings?: number;
  maxUnmappedSamples?: number;
};

const SOURCE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cxx", "cs", "go", "h", "hpp", "java", "js", "jsx", "kt", "kts", "mjs", "cjs",
  "mts", "cts", "php", "py", "pyi", "rb", "rs", "scala", "solve", "swift", "ts", "tsx",
]);
const DOCUMENT_EXTENSIONS = new Set(["md", "mdx"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
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

function isTestPath(path: string): boolean {
  const normalized = path.toLowerCase();
  const name = basename(normalized);
  const segments = normalized.split("/");
  if (segments.includes("__tests__") || segments.includes("tests") || segments.includes("test")) return true;
  if (/^test_.+\.(py|pyi)$/.test(name) || /.+_test\.(py|pyi)$/.test(name)) return true;
  return /(?:^|[._-])(test|spec)\.[^.]+$/.test(name);
}

function isDocumentationPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return DOCUMENT_EXTENSIONS.has(extension(path)) || /^readme(?:\.|$)/.test(name);
}

function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extension(path)) && !isTestPath(path);
}

function resolveDocumentationTarget(documentPath: string, rawTarget: string): string | undefined {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim();
  if (!target || target.startsWith("#") || target.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined;
  target = target.split(/[?#]/, 1)[0];
  if (!target) return undefined;

  const segments = dirname(documentPath).split("/").filter(Boolean);
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  if (segments.length === 0) return undefined;
  try {
    return normalizeRepositoryPath(segments.join("/"));
  } catch {
    return undefined;
  }
}

function markdownLinkOccurrences(text: string): Array<{ target: string; line: number }> {
  const found: Array<{ target: string; line: number }> = [];
  const expression = /\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of text.matchAll(expression)) {
    const target = match[1];
    if (!target) continue;
    const index = match.index ?? 0;
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) if (text[cursor] === "\n") line += 1;
    found.push({ target, line });
  }
  return found;
}

export function createRepositoryCoverageMap(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryCoverageMapOptions = {},
): RepositoryCoverageMap {
  const maxMappings = boundedInteger(options.maxMappings, 500, 1, 5_000, "Repository coverage maxMappings");
  const maxUnmappedSamples = boundedInteger(options.maxUnmappedSamples, 100, 1, 1_000, "Repository coverage maxUnmappedSamples");
  const snapshotFiles = new Map(snapshot.files.map((file) => {
    const path = normalizeRepositoryPath(file.path);
    return [path, { ...file, path }] as const;
  }));
  const pathByNodeId = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== "file" || typeof node.metadata?.path !== "string") continue;
    pathByNodeId.set(node.id, node.metadata.path);
  }
  const acceptedPaths = [...new Set(pathByNodeId.values())].sort(compareText);
  const acceptedPathSet = new Set(acceptedPaths);
  const sourcePaths = acceptedPaths.filter(isSourcePath);
  const sourcePathSet = new Set(sourcePaths);
  const testPaths = acceptedPaths.filter(isTestPath);
  const testPathSet = new Set(testPaths);
  const documentationPaths = acceptedPaths.filter(isDocumentationPath);

  const testPairs = new Map<string, RepositoryTestCoverageMapping>();
  for (const edge of graph.edges) {
    if (edge.kind !== "imports") continue;
    const fromPath = pathByNodeId.get(edge.from);
    const toPath = pathByNodeId.get(edge.to);
    if (!fromPath || !toPath || !testPathSet.has(fromPath) || !sourcePathSet.has(toPath)) continue;
    const key = `${fromPath}\u001f${toPath}`;
    const existing = testPairs.get(key);
    if (existing) existing.importEdgeCount += 1;
    else testPairs.set(key, { testPath: fromPath, targetPath: toPath, importEdgeCount: 1 });
  }

  const documentationPairs = new Map<string, RepositoryDocumentationMapping>();
  for (const documentPath of documentationPaths) {
    const file = snapshotFiles.get(documentPath);
    if (!file || typeof file.text !== "string") continue;
    for (const link of markdownLinkOccurrences(file.text)) {
      const targetPath = resolveDocumentationTarget(documentPath, link.target);
      if (!targetPath || !acceptedPathSet.has(targetPath) || !sourcePathSet.has(targetPath)) continue;
      const key = `${documentPath}\u001f${targetPath}`;
      const existing = documentationPairs.get(key);
      if (existing) {
        existing.linkCount += 1;
        existing.firstLine = Math.min(existing.firstLine, link.line);
      } else {
        documentationPairs.set(key, { documentPath, targetPath, linkCount: 1, firstLine: link.line });
      }
    }
  }

  const allTestMappings = [...testPairs.values()].sort((left, right) =>
    compareText(left.testPath, right.testPath) || compareText(left.targetPath, right.targetPath));
  const allDocumentationMappings = [...documentationPairs.values()].sort((left, right) =>
    compareText(left.documentPath, right.documentPath) || compareText(left.targetPath, right.targetPath));
  const combinedMappings = allTestMappings.length + allDocumentationMappings.length;
  const mappingsTruncated = combinedMappings > maxMappings;
  const testMappings = allTestMappings.slice(0, maxMappings);
  const remainingMappingCapacity = Math.max(0, maxMappings - testMappings.length);
  const documentationMappings = allDocumentationMappings.slice(0, remainingMappingCapacity);

  const testedTargets = new Set(allTestMappings.map((item) => item.targetPath));
  const documentedTargets = new Set(allDocumentationMappings.map((item) => item.targetPath));
  const withoutTests = sourcePaths.filter((path) => !testedTargets.has(path));
  const withoutDocumentation = sourcePaths.filter((path) => !documentedTargets.has(path));
  const samplesTruncated = withoutTests.length > maxUnmappedSamples || withoutDocumentation.length > maxUnmappedSamples;
  const graphTruncated = graph.execution.truncated;

  return {
    schema: "solvelang.repository-audit.coverage-map.v0",
    mode: "analyze-only",
    summary: {
      sourceFiles: sourcePaths.length,
      testFiles: testPaths.length,
      documentationFiles: documentationPaths.length,
      directlyTestedSourceFiles: testedTargets.size,
      documentationLinkedSourceFiles: documentedTargets.size,
    },
    testMappings,
    documentationMappings,
    sourceFilesWithoutDirectTestImport: withoutTests.slice(0, maxUnmappedSamples),
    sourceFilesWithoutDocumentationLink: withoutDocumentation.slice(0, maxUnmappedSamples),
    execution: {
      status: graphTruncated || mappingsTruncated || samplesTruncated ? "partial" : "complete",
      graphTruncated,
      mappingsTruncated,
      samplesTruncated,
      maxMappings,
      maxUnmappedSamples,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
