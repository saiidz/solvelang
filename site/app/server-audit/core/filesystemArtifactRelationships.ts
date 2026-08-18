import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;
const MAX_PATH_BYTES = 4_096;

export type ServerAuditFilesystemArtifactRelationshipKind =
  | "filesystem-log"
  | "filesystem-backup"
  | "ambiguous-filesystem-log"
  | "ambiguous-filesystem-backup";

export type ServerAuditFilesystemArtifactRelationship = {
  id: string;
  kind: ServerAuditFilesystemArtifactRelationshipKind;
  sources: string[];
  sourcesTruncated?: true;
};

export type ServerAuditFilesystemArtifactRelationshipOptions = {
  maxRelationships?: number;
};

export type ServerAuditFilesystemArtifactRelationshipAnalysis = {
  schema: "solvelang.server-audit.filesystem-artifact-relationships.v0";
  mode: "analyze-only";
  relationships: ServerAuditFilesystemArtifactRelationship[];
  summary: {
    filesystemsChecked: number;
    logsChecked: number;
    backupsChecked: number;
    mappedLogs: number;
    mappedBackups: number;
    ambiguousLogs: number;
    ambiguousBackups: number;
    unresolvedArtifacts: number;
    skippedInvalidArtifactPaths: number;
    skippedInvalidMountPaths: number;
    relationshipsWithTruncatedSources: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    pathResolution: "lexical-posix-only";
    maxRelationships: number;
    maxSourcesPerRelationship: number;
    relationshipsTruncated: boolean;
  };
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

function stableId(kind: ServerAuditFilesystemArtifactRelationshipKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-filesystem-artifact:${hash.toString(16).padStart(8, "0")}`;
}

function normalizeAbsolutePosixPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\0") || new TextEncoder().encode(trimmed).byteLength > MAX_PATH_BYTES) {
    return undefined;
  }
  const segments = trimmed.split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return undefined;
    normalized.push(segment);
  }
  return normalized.length === 0 ? "/" : `/${normalized.join("/")}`;
}

function pathIsWithinMount(path: string, mount: string): boolean {
  return mount === "/" || path === mount || path.startsWith(`${mount}/`);
}

function relationship(
  kind: ServerAuditFilesystemArtifactRelationshipKind,
  allSources: string[],
): ServerAuditFilesystemArtifactRelationship {
  const sources = allSources.slice(0, MAX_SOURCES_PER_RELATIONSHIP);
  return {
    id: stableId(kind, allSources),
    kind,
    sources,
    ...(allSources.length > sources.length ? { sourcesTruncated: true as const } : {}),
  };
}

export function analyzeServerAuditFilesystemArtifactRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditFilesystemArtifactRelationshipOptions = {},
): ServerAuditFilesystemArtifactRelationshipAnalysis {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    500,
    1,
    5_000,
    "Server Audit filesystem-artifact maxRelationships",
  );
  const filesystems = snapshot.filesystems ?? [];
  const logs = snapshot.logs ?? [];
  const backups = snapshot.backups ?? [];
  const validMounts: Array<{ index: number; path: string }> = [];
  let skippedInvalidMountPaths = 0;

  filesystems.forEach((filesystem, index) => {
    const path = normalizeAbsolutePosixPath(filesystem.mount);
    if (!path) {
      skippedInvalidMountPaths += 1;
      return;
    }
    validMounts.push({ index, path });
  });

  const relationships: ServerAuditFilesystemArtifactRelationship[] = [];
  let mappedLogs = 0;
  let mappedBackups = 0;
  let ambiguousLogs = 0;
  let ambiguousBackups = 0;
  let unresolvedArtifacts = 0;
  let skippedInvalidArtifactPaths = 0;

  function mapArtifact(kind: "log" | "backup", artifactIndex: number, rawPath: string | undefined): void {
    if (rawPath === undefined) {
      skippedInvalidArtifactPaths += 1;
      return;
    }
    const artifactPath = normalizeAbsolutePosixPath(rawPath);
    if (!artifactPath) {
      skippedInvalidArtifactPaths += 1;
      return;
    }

    const candidates = validMounts.filter((entry) => pathIsWithinMount(artifactPath, entry.path));
    if (candidates.length === 0) {
      unresolvedArtifacts += 1;
      return;
    }
    const longest = Math.max(...candidates.map((entry) => entry.path.length));
    const best = candidates
      .filter((entry) => entry.path.length === longest)
      .sort((left, right) => left.index - right.index);
    const artifactSource = kind === "log" ? `logs[${artifactIndex}]` : `backups[${artifactIndex}]`;
    const filesystemSources = best.map((entry) => `filesystems[${entry.index}]`);

    if (best.length === 1) {
      if (kind === "log") mappedLogs += 1;
      else mappedBackups += 1;
      relationships.push(relationship(
        kind === "log" ? "filesystem-log" : "filesystem-backup",
        [...filesystemSources, artifactSource],
      ));
      return;
    }

    if (kind === "log") ambiguousLogs += 1;
    else ambiguousBackups += 1;
    relationships.push(relationship(
      kind === "log" ? "ambiguous-filesystem-log" : "ambiguous-filesystem-backup",
      [...filesystemSources, artifactSource],
    ));
  }

  logs.forEach((entry, index) => mapArtifact("log", index, entry.path));
  backups.forEach((entry, index) => mapArtifact("backup", index, entry.path));

  relationships.sort((left, right) => compareText(left.id, right.id));
  const boundedRelationships = relationships.slice(0, maxRelationships);

  return {
    schema: "solvelang.server-audit.filesystem-artifact-relationships.v0",
    mode: "analyze-only",
    relationships: boundedRelationships,
    summary: {
      filesystemsChecked: filesystems.length,
      logsChecked: logs.length,
      backupsChecked: backups.length,
      mappedLogs,
      mappedBackups,
      ambiguousLogs,
      ambiguousBackups,
      unresolvedArtifacts,
      skippedInvalidArtifactPaths,
      skippedInvalidMountPaths,
      relationshipsWithTruncatedSources: boundedRelationships.filter((entry) => entry.sourcesTruncated).length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      pathResolution: "lexical-posix-only",
      maxRelationships,
      maxSourcesPerRelationship: MAX_SOURCES_PER_RELATIONSHIP,
      relationshipsTruncated: relationships.length > maxRelationships,
    },
  };
}
