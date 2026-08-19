import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryDeploymentPathKind =
  | "docker-copy-source"
  | "sam-code-uri"
  | "sam-content-uri"
  | "cloudflare-main"
  | "cloudflare-assets-directory"
  | "vercel-output-directory"
  | "netlify-publish-directory"
  | "netlify-functions-directory";

export type RepositoryDeploymentTargetState =
  | "present"
  | "outside-bounded-scan"
  | "missing";

export type RepositoryDeploymentPathEvidence = {
  evidenceId: string;
  kind: RepositoryDeploymentPathKind;
  fromPath: string;
  rawReference: string;
  targetPath: string;
  targetType: "file" | "directory";
  targetState: RepositoryDeploymentTargetState;
  evidence: {
    path: string;
    line?: number;
    field?: string;
  };
};

export type RepositoryDeploymentPathEvidenceAnalysis = {
  schema: "solvelang.repository-audit.deployment-path-evidence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  relationships: RepositoryDeploymentPathEvidence[];
  skipped: {
    missingText: number;
    oversizedText: number;
    invalidJson: number;
    dynamicReference: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
    maxConfigTextBytes: number;
    relationshipsTruncated: boolean;
    acceptedFiles: number;
    deploymentFilesExamined: number;
    graphTruncated: boolean;
  };
};

export type RepositoryDeploymentPathEvidenceOptions = {
  maxRelationships?: number;
  maxConfigTextBytes?: number;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
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

function isDynamicReference(value: string): boolean {
  return value.length === 0
    || value === "."
    || value.includes("\0")
    || value.includes("\\")
    || value.includes("$")
    || /[*?!\[\]{}]/.test(value)
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function resolveLocalPath(baseDirectory: string, rawReference: string): string | undefined {
  const trimmed = rawReference.replace(/^\.\//, "").replace(/\/$/, "");
  if (isDynamicReference(trimmed)) return undefined;
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

function pathObserved(paths: ReadonlySet<string>, targetPath: string, targetType: "file" | "directory"): boolean {
  if (targetType === "file") return paths.has(targetPath);
  const prefix = `${targetPath}/`;
  for (const path of paths) {
    if (path === targetPath || path.startsWith(prefix)) return true;
  }
  return false;
}

function targetState(
  targetPath: string,
  targetType: "file" | "directory",
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryDeploymentTargetState {
  if (pathObserved(acceptedPaths, targetPath, targetType)) return "present";
  if (pathObserved(snapshotPaths, targetPath, targetType)) return "outside-bounded-scan";
  return "missing";
}

function evidenceId(
  kind: RepositoryDeploymentPathKind,
  fromPath: string,
  targetPath: string,
  line?: number,
  field?: string,
): string {
  return `deployment-path:${kind}:${fromPath}:${field ?? line ?? "config"}:${targetPath}`;
}

function makeEvidence(
  kind: RepositoryDeploymentPathKind,
  fromPath: string,
  rawReference: string,
  targetPath: string,
  targetType: "file" | "directory",
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
  line?: number,
  field?: string,
): RepositoryDeploymentPathEvidence {
  return {
    evidenceId: evidenceId(kind, fromPath, targetPath, line, field),
    kind,
    fromPath,
    rawReference,
    targetPath,
    targetType,
    targetState: targetState(targetPath, targetType, snapshotPaths, acceptedPaths),
    evidence: { path: fromPath, ...(line === undefined ? {} : { line }), ...(field === undefined ? {} : { field }) },
  };
}

function dockerRelationships(
  path: string,
  text: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { relationships: RepositoryDeploymentPathEvidence[]; dynamicReference: number } {
  const relationships: RepositoryDeploymentPathEvidence[] = [];
  let dynamicReference = 0;
  const baseDirectory = dirname(path);
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^\s*(COPY|ADD)\s+(.+)$/i.exec(line);
    if (!match) continue;
    const body = match[2].trim();
    if (!body || body.endsWith("\\") || /(?:^|\s)--from(?:=|\s)/i.test(body)) {
      dynamicReference += 1;
      continue;
    }

    let sources: string[] = [];
    const withoutFlags = body.replace(/^(?:--[^\s]+\s+)*/, "");
    if (withoutFlags.startsWith("[")) {
      try {
        const values = JSON.parse(withoutFlags) as unknown;
        if (!Array.isArray(values) || values.length < 2 || !values.every((value) => typeof value === "string")) {
          dynamicReference += 1;
          continue;
        }
        sources = (values as string[]).slice(0, -1);
      } catch {
        dynamicReference += 1;
        continue;
      }
    } else {
      if (/['"]/.test(withoutFlags)) {
        dynamicReference += 1;
        continue;
      }
      const tokens = withoutFlags.split(/\s+/).filter(Boolean);
      if (tokens.length < 2) continue;
      sources = tokens.slice(0, -1);
    }

    for (const rawReference of sources) {
      const targetPath = resolveLocalPath(baseDirectory, rawReference);
      if (!targetPath) {
        dynamicReference += 1;
        continue;
      }
      const targetType: "file" | "directory" = rawReference.endsWith("/") ? "directory" : "file";
      relationships.push(makeEvidence(
        "docker-copy-source",
        path,
        rawReference,
        targetPath,
        targetType,
        snapshotPaths,
        acceptedPaths,
        index + 1,
      ));
    }
  }

  return { relationships, dynamicReference };
}

function samRelationships(
  path: string,
  text: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { relationships: RepositoryDeploymentPathEvidence[]; dynamicReference: number } {
  const relationships: RepositoryDeploymentPathEvidence[] = [];
  let dynamicReference = 0;
  const baseDirectory = dirname(path);
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(CodeUri|ContentUri):\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(lines[index]);
    if (!match) continue;
    const rawReference = match[2];
    const targetPath = resolveLocalPath(baseDirectory, rawReference);
    if (!targetPath) {
      dynamicReference += 1;
      continue;
    }
    relationships.push(makeEvidence(
      match[1] === "CodeUri" ? "sam-code-uri" : "sam-content-uri",
      path,
      rawReference,
      targetPath,
      "directory",
      snapshotPaths,
      acceptedPaths,
      index + 1,
    ));
  }
  return { relationships, dynamicReference };
}

function tomlSectionRelationships(
  path: string,
  text: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { relationships: RepositoryDeploymentPathEvidence[]; dynamicReference: number } {
  const relationships: RepositoryDeploymentPathEvidence[] = [];
  let dynamicReference = 0;
  let section = "";
  const baseDirectory = dirname(path);
  const lowerName = basename(path).toLowerCase();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(lines[index]);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    const pair = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(lines[index]);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const rawReference = pair[2];
    let kind: RepositoryDeploymentPathKind | undefined;
    let targetType: "file" | "directory" = "directory";
    if (lowerName === "wrangler.toml" && section === "" && key === "main") {
      kind = "cloudflare-main";
      targetType = "file";
    } else if (lowerName === "wrangler.toml" && section === "assets" && key === "directory") {
      kind = "cloudflare-assets-directory";
    } else if (lowerName === "netlify.toml" && section === "build" && key === "publish") {
      kind = "netlify-publish-directory";
    } else if (lowerName === "netlify.toml" && section === "functions" && key === "directory") {
      kind = "netlify-functions-directory";
    }
    if (!kind) continue;
    const targetPath = resolveLocalPath(baseDirectory, rawReference);
    if (!targetPath) {
      dynamicReference += 1;
      continue;
    }
    relationships.push(makeEvidence(kind, path, rawReference, targetPath, targetType, snapshotPaths, acceptedPaths, index + 1));
  }
  return { relationships, dynamicReference };
}

function jsonRelationships(
  path: string,
  text: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { relationships: RepositoryDeploymentPathEvidence[]; invalidJson: boolean; dynamicReference: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { relationships: [], invalidJson: true, dynamicReference: 0 };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { relationships: [], invalidJson: true, dynamicReference: 0 };
  }
  const record = parsed as Record<string, unknown>;
  const baseDirectory = dirname(path);
  const lowerName = basename(path).toLowerCase();
  const values: Array<{ kind: RepositoryDeploymentPathKind; rawReference: string; targetType: "file" | "directory"; field: string }> = [];

  if (lowerName === "wrangler.json") {
    if (typeof record.main === "string") values.push({ kind: "cloudflare-main", rawReference: record.main, targetType: "file", field: "main" });
    if (record.assets && typeof record.assets === "object" && !Array.isArray(record.assets)) {
      const directory = (record.assets as Record<string, unknown>).directory;
      if (typeof directory === "string") values.push({ kind: "cloudflare-assets-directory", rawReference: directory, targetType: "directory", field: "assets.directory" });
    }
  } else if (lowerName === "vercel.json" && typeof record.outputDirectory === "string") {
    values.push({ kind: "vercel-output-directory", rawReference: record.outputDirectory, targetType: "directory", field: "outputDirectory" });
  }

  let dynamicReference = 0;
  const relationships = values.flatMap(({ kind, rawReference, targetType, field }) => {
    const targetPath = resolveLocalPath(baseDirectory, rawReference);
    if (!targetPath) {
      dynamicReference += 1;
      return [];
    }
    return [makeEvidence(kind, path, rawReference, targetPath, targetType, snapshotPaths, acceptedPaths, undefined, field)];
  });
  return { relationships, invalidJson: false, dynamicReference };
}

function isDeploymentConfig(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === "dockerfile"
    || name.startsWith("dockerfile.")
    || name === "template.yaml"
    || name === "template.yml"
    || name === "sam-template.yaml"
    || name === "sam-template.yml"
    || name === "wrangler.toml"
    || name === "wrangler.json"
    || name === "vercel.json"
    || name === "netlify.toml";
}

export async function createRepositoryDeploymentPathEvidenceAnalysis(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryDeploymentPathEvidenceOptions = {},
): Promise<RepositoryDeploymentPathEvidenceAnalysis> {
  const maxRelationships = boundedInteger(options.maxRelationships, 250, 1, 2_000, "Repository deployment path maxRelationships");
  const maxConfigTextBytes = boundedInteger(options.maxConfigTextBytes, 1024 * 1024, 1, 10 * 1024 * 1024, "Repository deployment path maxConfigTextBytes");
  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) throw new Error("Repository deployment path evidence source does not match the bounded Solve Graph source.");

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) throw new Error(`Repository deployment path evidence received duplicate path: ${path}`);
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
  let oversizedText = 0;
  let invalidJson = 0;
  let dynamicReference = 0;
  let deploymentFilesExamined = 0;
  const allRelationships: RepositoryDeploymentPathEvidence[] = [];

  for (const path of [...acceptedPaths].sort(compareText)) {
    if (!isDeploymentConfig(path)) continue;
    deploymentFilesExamined += 1;
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Bounded Solve Graph references an unavailable repository file: ${path}`);
    if (typeof file.text !== "string") {
      missingText += 1;
      continue;
    }
    if (textBytes(file.text) > maxConfigTextBytes) {
      oversizedText += 1;
      continue;
    }

    const name = basename(path).toLowerCase();
    if (name === "dockerfile" || name.startsWith("dockerfile.")) {
      const result = dockerRelationships(path, file.text, snapshotPaths, acceptedPaths);
      allRelationships.push(...result.relationships);
      dynamicReference += result.dynamicReference;
    } else if (name === "template.yaml" || name === "template.yml" || name === "sam-template.yaml" || name === "sam-template.yml") {
      const result = samRelationships(path, file.text, snapshotPaths, acceptedPaths);
      allRelationships.push(...result.relationships);
      dynamicReference += result.dynamicReference;
    } else if (name === "wrangler.toml" || name === "netlify.toml") {
      const result = tomlSectionRelationships(path, file.text, snapshotPaths, acceptedPaths);
      allRelationships.push(...result.relationships);
      dynamicReference += result.dynamicReference;
    } else {
      const result = jsonRelationships(path, file.text, snapshotPaths, acceptedPaths);
      allRelationships.push(...result.relationships);
      invalidJson += result.invalidJson ? 1 : 0;
      dynamicReference += result.dynamicReference;
    }
  }

  allRelationships.sort((left, right) => compareText(left.kind, right.kind)
    || compareText(left.fromPath, right.fromPath)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId));
  const relationshipsTruncated = allRelationships.length > maxRelationships;
  const relationships = allRelationships.slice(0, maxRelationships);
  const graphTruncated = graph.execution.status === "partial" || graph.execution.truncated;
  const partial = graphTruncated || relationshipsTruncated || missingText > 0 || oversizedText > 0 || invalidJson > 0 || dynamicReference > 0;

  return {
    schema: "solvelang.repository-audit.deployment-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: partial ? "partial" : "complete",
    relationships,
    skipped: { missingText, oversizedText, invalidJson, dynamicReference },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxConfigTextBytes,
      relationshipsTruncated,
      acceptedFiles: acceptedPaths.size,
      deploymentFilesExamined,
      graphTruncated,
    },
  };
}
