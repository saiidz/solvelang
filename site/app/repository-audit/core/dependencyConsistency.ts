import type { SolveGraphDocument } from "../../solve-graph/core/contracts";
import { scanJavaScriptImportSpecifiers } from "../../solve-graph/core/import-extractor";
import {
  normalizeRepositoryPath,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryDependencyConsistencyEvidence = {
  path: string;
  line: number;
  column: number;
  specifier: string;
};

export type RepositoryDependencyConsistencyFinding = {
  packageName: string;
  confidence: "high" | "medium";
  occurrenceCount: number;
  evidence: RepositoryDependencyConsistencyEvidence[];
  evidenceTruncated: boolean;
};

export type RepositoryDependencyConsistency = {
  schema: "solvelang.repository-audit.dependency-consistency.v0";
  mode: "analyze-only";
  declaredPackages: string[];
  workspacePackages: string[];
  importedPackages: string[];
  undeclaredImports: RepositoryDependencyConsistencyFinding[];
  execution: {
    status: "complete" | "partial";
    filesScanned: number;
    manifestsScanned: number;
    configFilesScanned: number;
    parseFailures: number;
    findingsSuppressed: boolean;
    findingsTruncated: boolean;
    maxFindings: number;
    maxEvidencePerFinding: number;
    networkAccess: false;
    writeAccess: false;
  };
};

export type RepositoryDependencyConsistencyOptions = {
  maxFindings?: number;
  maxEvidencePerFinding?: number;
};

const JAVA_SCRIPT_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
  "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https", "module", "net", "os",
  "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder",
  "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

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

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

function packageRoot(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return undefined;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) return undefined;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2 || !/^@[A-Za-z0-9._-]+$/.test(parts[0]) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1])) return undefined;
    return `${parts[0]}/${parts[1]}`;
  }
  const root = specifier.split("/", 1)[0];
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(root) ? root : undefined;
}

function aliasMatches(specifier: string, pattern: string): boolean {
  const star = pattern.indexOf("*");
  if (star < 0) return specifier === pattern;
  if (pattern.indexOf("*", star + 1) >= 0) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return specifier.startsWith(prefix)
    && specifier.endsWith(suffix)
    && specifier.length >= prefix.length + suffix.length;
}

function findingConfidence(specifier: string, packageName: string): "high" | "medium" {
  return packageName.startsWith("@") || specifier === packageName ? "high" : "medium";
}

export function analyzeRepositoryDependencyConsistency(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryDependencyConsistencyOptions = {},
): RepositoryDependencyConsistency {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Repository dependency maxFindings");
  const maxEvidencePerFinding = boundedInteger(options.maxEvidencePerFinding, 10, 1, 100, "Repository dependency maxEvidencePerFinding");
  const filesByPath = new Map(snapshot.files.map((file) => {
    const path = normalizeRepositoryPath(file.path);
    return [path, { ...file, path }] as const;
  }));
  const acceptedPaths = graph.nodes
    .filter((node) => node.kind === "file" && typeof node.metadata?.path === "string")
    .map((node) => node.metadata!.path as string)
    .sort(compareText);

  const declaredPackages = new Set<string>();
  const workspacePackages = new Set<string>();
  const aliasPatterns = new Set<string>();
  let manifestsScanned = 0;
  let configFilesScanned = 0;
  let parseFailures = 0;

  for (const path of acceptedPaths) {
    const file = filesByPath.get(path);
    if (!file || typeof file.text !== "string") continue;
    const name = basename(path).toLowerCase();
    if (name === "package.json") {
      manifestsScanned += 1;
      try {
        const parsed = JSON.parse(file.text) as Record<string, unknown>;
        if (typeof parsed.name === "string" && parsed.name.trim()) workspacePackages.add(parsed.name.trim());
        for (const field of DEPENDENCY_FIELDS) {
          const values = parsed[field];
          if (!values || typeof values !== "object" || Array.isArray(values)) continue;
          for (const dependencyName of Object.keys(values as Record<string, unknown>)) declaredPackages.add(dependencyName);
        }
      } catch {
        parseFailures += 1;
      }
      continue;
    }
    if (name === "tsconfig.json" || name === "jsconfig.json") {
      configFilesScanned += 1;
      try {
        const parsed = JSON.parse(file.text) as { compilerOptions?: { paths?: unknown } };
        const paths = parsed.compilerOptions?.paths;
        if (paths && typeof paths === "object" && !Array.isArray(paths)) {
          for (const pattern of Object.keys(paths as Record<string, unknown>)) aliasPatterns.add(pattern);
        }
      } catch {
        parseFailures += 1;
      }
    }
  }

  const importedPackages = new Set<string>();
  const occurrences = new Map<string, Array<RepositoryDependencyConsistencyEvidence & { confidence: "high" | "medium" }>>();
  let filesScanned = 0;

  for (const path of acceptedPaths) {
    if (!JAVA_SCRIPT_EXTENSIONS.has(extension(path))) continue;
    const file = filesByPath.get(path);
    if (!file || typeof file.text !== "string") continue;
    filesScanned += 1;
    for (const item of scanJavaScriptImportSpecifiers(file.text)) {
      if ([...aliasPatterns].some((pattern) => aliasMatches(item.specifier, pattern))) continue;
      const packageName = packageRoot(item.specifier);
      if (!packageName || NODE_BUILTINS.has(packageName)) continue;
      importedPackages.add(packageName);
      if (declaredPackages.has(packageName) || workspacePackages.has(packageName)) continue;
      const list = occurrences.get(packageName) ?? [];
      list.push({
        path,
        line: item.line,
        column: item.column,
        specifier: item.specifier,
        confidence: findingConfidence(item.specifier, packageName),
      });
      occurrences.set(packageName, list);
    }
  }

  // A truncated graph or malformed manifest/config means declaration/alias evidence may be incomplete.
  // Fail closed by suppressing undeclared-import findings instead of presenting false certainty.
  const findingsSuppressed = graph.execution.truncated || parseFailures > 0;
  const candidates = [...occurrences.entries()]
    .sort(([left], [right]) => compareText(left, right));
  const findingsTruncated = !findingsSuppressed && candidates.length > maxFindings;
  const undeclaredImports: RepositoryDependencyConsistencyFinding[] = findingsSuppressed
    ? []
    : candidates.slice(0, maxFindings).map(([packageName, items]) => {
      const ordered = [...items].sort((left, right) =>
        compareText(left.path, right.path)
        || left.line - right.line
        || left.column - right.column
        || compareText(left.specifier, right.specifier));
      const evidence = ordered.slice(0, maxEvidencePerFinding).map(({ confidence: _confidence, ...item }) => item);
      return {
        packageName,
        confidence: ordered.every((item) => item.confidence === "high") ? "high" : "medium",
        occurrenceCount: ordered.length,
        evidence,
        evidenceTruncated: evidence.length < ordered.length,
      };
    });

  const partial = findingsSuppressed || findingsTruncated;
  return {
    schema: "solvelang.repository-audit.dependency-consistency.v0",
    mode: "analyze-only",
    declaredPackages: [...declaredPackages].sort(compareText),
    workspacePackages: [...workspacePackages].sort(compareText),
    importedPackages: [...importedPackages].sort(compareText),
    undeclaredImports,
    execution: {
      status: partial ? "partial" : "complete",
      filesScanned,
      manifestsScanned,
      configFilesScanned,
      parseFailures,
      findingsSuppressed,
      findingsTruncated,
      maxFindings,
      maxEvidencePerFinding,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
