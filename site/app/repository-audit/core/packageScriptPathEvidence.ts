import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryPackageScriptPathKind =
  | "node-entrypoint"
  | "tsx-entrypoint"
  | "ts-node-entrypoint"
  | "tsc-project"
  | "vite-config"
  | "eslint-config";

export type RepositoryPackageScriptTargetState = "present" | "outside-bounded-scan" | "missing";

export type RepositoryPackageScriptPathEvidence = {
  evidenceId: string;
  kind: RepositoryPackageScriptPathKind;
  fromPath: string;
  scriptName: string;
  rawReference: string;
  targetPath: string;
  targetState: RepositoryPackageScriptTargetState;
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryPackageScriptPathEvidenceOptions = {
  maxRelationships?: number;
  maxPackageTextBytes?: number;
  maxScriptTextBytes?: number;
};

export type RepositoryPackageScriptPathEvidenceAnalysis = {
  schema: "solvelang.repository-audit.package-script-path-evidence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  relationships: RepositoryPackageScriptPathEvidence[];
  skipped: {
    missingText: number;
    oversizedPackageText: number;
    oversizedScript: number;
    invalidJson: number;
    dynamicScript: number;
    invalidTarget: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
    maxPackageTextBytes: number;
    maxScriptTextBytes: number;
    relationshipsTruncated: boolean;
    acceptedFiles: number;
    packageFilesExamined: number;
    graphTruncated: boolean;
  };
};

type DetectedTarget = {
  kind: RepositoryPackageScriptPathKind;
  rawReference: string;
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathForNode(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function sameSource(snapshot: RepositorySnapshot, graph: SolveGraphDocument): boolean {
  return snapshot.source.displayName === graph.source.displayName
    && snapshot.source.revision === graph.source.revision
    && snapshot.source.fingerprint === graph.source.fingerprint;
}

function isPackageJson(path: string): boolean {
  return basename(path).toLowerCase() === "package.json";
}

function hasUnsupportedShellSyntax(script: string): boolean {
  return /[;&|<>`$\\\r\n"']/.test(script);
}

function simpleTokens(script: string): string[] | undefined {
  const normalized = script.normalize("NFC").trim();
  if (!normalized || hasUnsupportedShellSyntax(normalized)) return undefined;
  return normalized.split(/\s+/).filter(Boolean);
}

function flagValue(tokens: readonly string[], shortFlag: string, longFlag: string): string | undefined {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === shortFlag || token === longFlag) return tokens[index + 1];
    if (token.startsWith(`${longFlag}=`)) return token.slice(longFlag.length + 1);
  }
  return undefined;
}

function detectTarget(tokens: readonly string[]): DetectedTarget | undefined {
  let commandIndex = 0;
  if (tokens[0] === "npx") commandIndex = 1;
  const command = tokens[commandIndex];
  if (!command) return undefined;
  const commandTokens = tokens.slice(commandIndex);

  if (command === "node" || command === "tsx" || command === "ts-node") {
    const rawReference = commandTokens[1];
    if (!rawReference || rawReference.startsWith("-")) return undefined;
    return {
      kind: command === "node"
        ? "node-entrypoint"
        : command === "tsx"
          ? "tsx-entrypoint"
          : "ts-node-entrypoint",
      rawReference,
    };
  }

  if (command === "tsc") {
    const rawReference = flagValue(commandTokens, "-p", "--project");
    return rawReference ? { kind: "tsc-project", rawReference } : undefined;
  }
  if (command === "vite") {
    const rawReference = flagValue(commandTokens, "-c", "--config");
    return rawReference ? { kind: "vite-config", rawReference } : undefined;
  }
  if (command === "eslint") {
    const rawReference = flagValue(commandTokens, "-c", "--config");
    return rawReference ? { kind: "eslint-config", rawReference } : undefined;
  }
  return undefined;
}

function resolveLocalPath(baseDirectory: string, rawReference: string): string | undefined {
  const trimmed = rawReference.replace(/^\.\//, "").replace(/\/$/, "");
  if (!trimmed
    || trimmed === "."
    || trimmed.includes("\0")
    || trimmed.includes("\\")
    || trimmed.includes("$")
    || /[*?!\[\]{}]/.test(trimmed)
    || trimmed.startsWith("/")
    || /^[A-Za-z]:/.test(trimmed)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) {
    return undefined;
  }

  const parts = baseDirectory ? baseDirectory.split("/") : [];
  for (const segment of trimmed.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) return undefined;
  try {
    return normalizeRepositoryPath(parts.join("/"));
  } catch {
    return undefined;
  }
}

function targetState(
  targetPath: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryPackageScriptTargetState {
  if (acceptedPaths.has(targetPath)) return "present";
  if (snapshotPaths.has(targetPath)) return "outside-bounded-scan";
  return "missing";
}

function evidenceId(
  kind: RepositoryPackageScriptPathKind,
  fromPath: string,
  scriptName: string,
  targetPath: string,
): string {
  return `package-script-path:${kind}:${fromPath}:${scriptName}:${targetPath}`;
}

export async function createRepositoryPackageScriptPathEvidenceAnalysis(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryPackageScriptPathEvidenceOptions = {},
): Promise<RepositoryPackageScriptPathEvidenceAnalysis> {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    250,
    1,
    2_000,
    "Repository package script path maxRelationships",
  );
  const maxPackageTextBytes = boundedInteger(
    options.maxPackageTextBytes,
    1024 * 1024,
    1,
    10 * 1024 * 1024,
    "Repository package script path maxPackageTextBytes",
  );
  const maxScriptTextBytes = boundedInteger(
    options.maxScriptTextBytes,
    4 * 1024,
    1,
    64 * 1024,
    "Repository package script path maxScriptTextBytes",
  );

  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) {
    throw new Error("Repository package script path evidence source does not match the bounded Solve Graph source.");
  }

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) {
      throw new Error(`Repository package script path evidence received duplicate path: ${path}`);
    }
    filesByPath.set(path, { ...file, path });
  }
  const snapshotPaths = new Set(filesByPath.keys());
  const acceptedPaths = new Set(
    graph.nodes
      .filter((node) => node.kind === "file")
      .map(pathForNode)
      .filter((path): path is string => typeof path === "string" && path.length > 0)
      .map(normalizeRepositoryPath),
  );

  let missingText = 0;
  let oversizedPackageText = 0;
  let oversizedScript = 0;
  let invalidJson = 0;
  let dynamicScript = 0;
  let invalidTarget = 0;
  let packageFilesExamined = 0;
  const allRelationships: RepositoryPackageScriptPathEvidence[] = [];

  for (const path of [...acceptedPaths].sort(compareText)) {
    if (!isPackageJson(path)) continue;
    packageFilesExamined += 1;
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Bounded Solve Graph references an unavailable repository file: ${path}`);
    if (typeof file.text !== "string") {
      missingText += 1;
      continue;
    }
    if (textBytes(file.text) > maxPackageTextBytes) {
      oversizedPackageText += 1;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch {
      invalidJson += 1;
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalidJson += 1;
      continue;
    }
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) continue;

    for (const [scriptName, scriptValue] of Object.entries(scripts as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))) {
      if (typeof scriptValue !== "string") continue;
      if (textBytes(scriptValue) > maxScriptTextBytes) {
        oversizedScript += 1;
        continue;
      }
      const tokens = simpleTokens(scriptValue);
      if (!tokens) {
        dynamicScript += 1;
        continue;
      }
      const detected = detectTarget(tokens);
      if (!detected) continue;
      const targetPath = resolveLocalPath(dirname(path), detected.rawReference);
      if (!targetPath) {
        invalidTarget += 1;
        continue;
      }
      allRelationships.push({
        evidenceId: evidenceId(detected.kind, path, scriptName, targetPath),
        kind: detected.kind,
        fromPath: path,
        scriptName,
        rawReference: detected.rawReference,
        targetPath,
        targetState: targetState(targetPath, snapshotPaths, acceptedPaths),
        evidence: { path, field: `scripts.${scriptName}` },
      });
    }
  }

  allRelationships.sort((left, right) => compareText(left.fromPath, right.fromPath)
    || compareText(left.scriptName, right.scriptName)
    || compareText(left.kind, right.kind)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId));
  const relationshipsTruncated = allRelationships.length > maxRelationships;
  const relationships = allRelationships.slice(0, maxRelationships);
  const graphTruncated = graph.execution.status === "partial" || graph.execution.truncated;
  const partial = graphTruncated
    || relationshipsTruncated
    || missingText > 0
    || oversizedPackageText > 0
    || oversizedScript > 0
    || invalidJson > 0
    || dynamicScript > 0
    || invalidTarget > 0;

  return {
    schema: "solvelang.repository-audit.package-script-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: partial ? "partial" : "complete",
    relationships,
    skipped: {
      missingText,
      oversizedPackageText,
      oversizedScript,
      invalidJson,
      dynamicScript,
      invalidTarget,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxPackageTextBytes,
      maxScriptTextBytes,
      relationshipsTruncated,
      acceptedFiles: acceptedPaths.size,
      packageFilesExamined,
      graphTruncated,
    },
  };
}
