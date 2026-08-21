import type { ServerAuditSnapshot } from "./types";

export type ServerAuditInventoryIssueKind =
  | "conflicting-package-version"
  | "conflicting-service-state"
  | "conflicting-filesystem-capacity"
  | "conflicting-web-root-metadata"
  | "conflicting-process-identity"
  | "self-parent-process"
  | "cyclic-process-parentage";

export type ServerAuditInventoryIssue = {
  id: string;
  kind: ServerAuditInventoryIssueKind;
  severity: "low" | "info";
  sources: string[];
  sourceCount: number;
  sourcesTruncated: boolean;
  summary: string;
};

export type ServerAuditInventoryConsistencyOptions = {
  maxIssues?: number;
  maxSourcesPerIssue?: number;
};

export type ServerAuditInventoryConsistencyAnalysis = {
  schema: "solvelang.server-audit.inventory-consistency.v0";
  mode: "analyze-only";
  issues: ServerAuditInventoryIssue[];
  summary: {
    packagesChecked: number;
    servicesChecked: number;
    filesystemsChecked: number;
    webRootsChecked: number;
    processesChecked: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxIssues: number;
    maxSourcesPerIssue: number;
    issuesTruncated: boolean;
    issueSourcesTruncated: boolean;
  };
};

const IDENTITY_SOURCE_LIMIT = 32;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditInventoryIssueKind, sources: string[]): string {
  const sourceCount = sources.length;
  const identitySources = sources.slice(0, IDENTITY_SOURCE_LIMIT);
  const completeInput = `${kind}\u001f${identitySources.join("\u001f")}`;
  const input = sourceCount > identitySources.length
    ? `${completeInput}\u001fsources-truncated:${sourceCount}`
    : completeInput;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-inventory:${hash.toString(16).padStart(8, "0")}`;
}

function compareIssue(left: ServerAuditInventoryIssue, right: ServerAuditInventoryIssue): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function groupIndexes<T>(items: T[], key: (item: T) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const value = key(item);
    const current = groups.get(value) ?? [];
    current.push(index);
    groups.set(value, current);
  });
  return groups;
}

function distinct(values: Array<string | number | undefined>): number {
  return new Set(values.map((value) => value === undefined ? "<undefined>" : String(value))).size;
}

function issueWithBoundedSources(
  kind: ServerAuditInventoryIssueKind,
  severity: "low" | "info",
  sources: string[],
  summary: string,
  maxSourcesPerIssue: number,
): ServerAuditInventoryIssue {
  const sourceCount = sources.length;
  const boundedSources = sources.slice(0, maxSourcesPerIssue);
  return {
    id: stableId(kind, sources),
    kind,
    severity,
    sources: boundedSources,
    sourceCount,
    sourcesTruncated: sourceCount > boundedSources.length,
    summary,
  };
}

function selectBoundedConflictSources(
  sources: string[],
  variants: Array<string | number | undefined>,
  maxSourcesPerIssue: number,
): string[] {
  const normalizedVariants = variants.map((value) => value === undefined ? "<undefined>" : String(value));
  const firstVariant = normalizedVariants[0];
  const conflictingIndex = normalizedVariants.findIndex((variant) => variant !== firstVariant);
  if (conflictingIndex < 1) {
    throw new Error("Server Audit inventory conflict evidence requires two distinct metadata variants.");
  }

  const selectedIndexes = [0, conflictingIndex];
  for (let index = 1; index < sources.length && selectedIndexes.length < maxSourcesPerIssue; index += 1) {
    if (index === conflictingIndex) continue;
    selectedIndexes.push(index);
  }
  selectedIndexes.sort((left, right) => left - right);
  return selectedIndexes.map((index) => sources[index]!);
}

function conflictIssueWithBoundedSources(
  kind: ServerAuditInventoryIssueKind,
  severity: "low" | "info",
  sources: string[],
  variants: Array<string | number | undefined>,
  summary: string,
  maxSourcesPerIssue: number,
): ServerAuditInventoryIssue {
  const sourceCount = sources.length;
  const boundedSources = selectBoundedConflictSources(sources, variants, maxSourcesPerIssue);
  return {
    id: stableId(kind, sources),
    kind,
    severity,
    sources: boundedSources,
    sourceCount,
    sourcesTruncated: sourceCount > boundedSources.length,
    summary,
  };
}

export function analyzeServerAuditInventoryConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditInventoryConsistencyOptions = {},
): ServerAuditInventoryConsistencyAnalysis {
  const maxIssues = boundedInteger(options.maxIssues, 500, 1, 5_000, "Server Audit inventory maxIssues");
  const maxSourcesPerIssue = boundedInteger(
    options.maxSourcesPerIssue,
    32,
    2,
    256,
    "Server Audit inventory maxSourcesPerIssue",
  );
  const issues: ServerAuditInventoryIssue[] = [];
  const packages = snapshot.packages ?? [];
  const services = snapshot.services ?? [];
  const filesystems = snapshot.filesystems ?? [];
  const roots = snapshot.web?.roots ?? [];
  const processes = snapshot.processes ?? [];

  for (const indexes of groupIndexes(packages, (entry) => entry.name).values()) {
    if (indexes.length < 2) continue;
    const versions = indexes.map((index) => packages[index].version);
    if (distinct(versions) < 2) continue;
    const sources = indexes.map((index) => `packages[${index}]`);
    issues.push(conflictIssueWithBoundedSources(
      "conflicting-package-version",
      "low",
      sources,
      versions,
      "Multiple entries for the same package name report different versions; package posture is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  for (const indexes of groupIndexes(services, (entry) => entry.name).values()) {
    if (indexes.length < 2) continue;
    const states = indexes.map((index) => `${services[index].state}\u001f${services[index].enabled ?? ""}`);
    if (distinct(states) < 2) continue;
    const sources = indexes.map((index) => `services[${index}]`);
    issues.push(conflictIssueWithBoundedSources(
      "conflicting-service-state",
      "info",
      sources,
      states,
      "Multiple entries for the same service name report different state or enablement values; service posture is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  for (const indexes of groupIndexes(filesystems, (entry) => entry.mount).values()) {
    if (indexes.length < 2) continue;
    const capacityTuples = indexes.map((index) => {
      const entry = filesystems[index];
      return `${entry.sizeBytes ?? ""}\u001f${entry.usedBytes ?? ""}\u001f${entry.availableBytes ?? ""}\u001f${entry.usagePercent ?? ""}`;
    });
    if (distinct(capacityTuples) < 2) continue;
    const sources = indexes.map((index) => `filesystems[${index}]`);
    issues.push(conflictIssueWithBoundedSources(
      "conflicting-filesystem-capacity",
      "low",
      sources,
      capacityTuples,
      "Multiple entries for the same filesystem mount report different capacity or utilization values; storage posture is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  for (const indexes of groupIndexes(roots, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => `${roots[index].owner ?? ""}\u001f${roots[index].mode ?? ""}`);
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `web.roots[${index}]`);
    issues.push(conflictIssueWithBoundedSources(
      "conflicting-web-root-metadata",
      "info",
      sources,
      metadata,
      "Multiple entries for the same web-root path report different ownership or mode metadata; permission posture is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  const processGroups = groupIndexes(processes, (entry) => String(entry.pid));
  for (const indexes of processGroups.values()) {
    if (indexes.length < 2) continue;
    const identities = indexes.map((index) => {
      const entry = processes[index];
      return `${entry.ppid}\u001f${entry.uid}\u001f${entry.state}\u001f${entry.name}`;
    });
    if (distinct(identities) < 2) continue;
    const sources = indexes.map((index) => `processes[${index}]`);
    issues.push(conflictIssueWithBoundedSources(
      "conflicting-process-identity",
      "low",
      sources,
      identities,
      "Multiple process entries report the same PID with different parent, owner, state, or executable identity; process evidence is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  processes.forEach((entry, index) => {
    if (entry.pid !== entry.ppid) return;
    const sources = [`processes[${index}]`];
    issues.push(issueWithBoundedSources(
      "self-parent-process",
      "low",
      sources,
      "A collected process reports itself as its own parent; process topology is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  });

  const uniqueProcessIndex = new Map<number, number>();
  for (const indexes of processGroups.values()) {
    if (indexes.length !== 1) continue;
    const index = indexes[0];
    uniqueProcessIndex.set(processes[index].pid, index);
  }

  const emittedCycles = new Set<string>();
  for (const startPid of [...uniqueProcessIndex.keys()].sort((left, right) => left - right)) {
    const path: number[] = [];
    const position = new Map<number, number>();
    let currentPid: number | undefined = startPid;

    while (currentPid !== undefined) {
      const previous = position.get(currentPid);
      if (previous !== undefined) {
        const cycle = path.slice(previous);
        if (cycle.length > 1) {
          const cycleKey = [...cycle].sort((left, right) => left - right).join(":");
          if (!emittedCycles.has(cycleKey)) {
            emittedCycles.add(cycleKey);
            const sources = cycle
              .map((pid) => `processes[${uniqueProcessIndex.get(pid)!}]`)
              .sort();
            issues.push(issueWithBoundedSources(
              "cyclic-process-parentage",
              "low",
              sources,
              "Collected parent-process relationships form a cycle; process topology is internally inconsistent and may reflect collection-time churn or malformed evidence.",
              maxSourcesPerIssue,
            ));
          }
        }
        break;
      }

      const index = uniqueProcessIndex.get(currentPid);
      if (index === undefined) break;
      position.set(currentPid, path.length);
      path.push(currentPid);
      const parentPid = processes[index].ppid;
      if (parentPid <= 1 || parentPid === currentPid || !uniqueProcessIndex.has(parentPid)) break;
      currentPid = parentPid;
    }
  }

  issues.sort(compareIssue);
  const boundedIssues = issues.slice(0, maxIssues);
  return {
    schema: "solvelang.server-audit.inventory-consistency.v0",
    mode: "analyze-only",
    issues: boundedIssues,
    summary: {
      packagesChecked: packages.length,
      servicesChecked: services.length,
      filesystemsChecked: filesystems.length,
      webRootsChecked: roots.length,
      processesChecked: processes.length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxIssues,
      maxSourcesPerIssue,
      issuesTruncated: issues.length > maxIssues,
      issueSourcesTruncated: boundedIssues.some((issue) => issue.sourcesTruncated),
    },
  };
}
