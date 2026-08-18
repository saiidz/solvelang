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
  summary: string;
};

export type ServerAuditInventoryConsistencyOptions = {
  maxIssues?: number;
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
    issuesTruncated: boolean;
  };
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditInventoryIssueKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
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

export function analyzeServerAuditInventoryConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditInventoryConsistencyOptions = {},
): ServerAuditInventoryConsistencyAnalysis {
  const maxIssues = boundedInteger(options.maxIssues, 500, 1, 5_000, "Server Audit inventory maxIssues");
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
    issues.push({
      id: stableId("conflicting-package-version", sources),
      kind: "conflicting-package-version",
      severity: "low",
      sources,
      summary: "Multiple entries for the same package name report different versions; package posture is internally inconsistent.",
    });
  }

  for (const indexes of groupIndexes(services, (entry) => entry.name).values()) {
    if (indexes.length < 2) continue;
    const states = indexes.map((index) => `${services[index].state}\u001f${services[index].enabled ?? ""}`);
    if (distinct(states) < 2) continue;
    const sources = indexes.map((index) => `services[${index}]`);
    issues.push({
      id: stableId("conflicting-service-state", sources),
      kind: "conflicting-service-state",
      severity: "info",
      sources,
      summary: "Multiple entries for the same service name report different state or enablement values; service posture is internally inconsistent.",
    });
  }

  for (const indexes of groupIndexes(filesystems, (entry) => entry.mount).values()) {
    if (indexes.length < 2) continue;
    const capacityTuples = indexes.map((index) => {
      const entry = filesystems[index];
      return `${entry.sizeBytes ?? ""}\u001f${entry.usedBytes ?? ""}\u001f${entry.availableBytes ?? ""}\u001f${entry.usagePercent ?? ""}`;
    });
    if (distinct(capacityTuples) < 2) continue;
    const sources = indexes.map((index) => `filesystems[${index}]`);
    issues.push({
      id: stableId("conflicting-filesystem-capacity", sources),
      kind: "conflicting-filesystem-capacity",
      severity: "low",
      sources,
      summary: "Multiple entries for the same filesystem mount report different capacity or utilization values; storage posture is internally inconsistent.",
    });
  }

  for (const indexes of groupIndexes(roots, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => `${roots[index].owner ?? ""}\u001f${roots[index].mode ?? ""}`);
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `web.roots[${index}]`);
    issues.push({
      id: stableId("conflicting-web-root-metadata", sources),
      kind: "conflicting-web-root-metadata",
      severity: "info",
      sources,
      summary: "Multiple entries for the same web-root path report different ownership or mode metadata; permission posture is internally inconsistent.",
    });
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
    issues.push({
      id: stableId("conflicting-process-identity", sources),
      kind: "conflicting-process-identity",
      severity: "low",
      sources,
      summary: "Multiple process entries report the same PID with different parent, owner, state, or executable identity; process evidence is internally inconsistent.",
    });
  }

  processes.forEach((entry, index) => {
    if (entry.pid !== entry.ppid) return;
    const sources = [`processes[${index}]`];
    issues.push({
      id: stableId("self-parent-process", sources),
      kind: "self-parent-process",
      severity: "low",
      sources,
      summary: "A collected process reports itself as its own parent; process topology is internally inconsistent.",
    });
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
            issues.push({
              id: stableId("cyclic-process-parentage", sources),
              kind: "cyclic-process-parentage",
              severity: "low",
              sources,
              summary: "Collected parent-process relationships form a cycle; process topology is internally inconsistent and may reflect collection-time churn or malformed evidence.",
            });
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
  return {
    schema: "solvelang.server-audit.inventory-consistency.v0",
    mode: "analyze-only",
    issues: issues.slice(0, maxIssues),
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
      issuesTruncated: issues.length > maxIssues,
    },
  };
}
