import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditBackupCoverageOptions = {
  maxFindings?: number;
};

const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

function siftWorstFindingUp(heap: ServerAuditFinding[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareFinding(heap[parentIndex], heap[index]) >= 0) return;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function siftWorstFindingDown(heap: ServerAuditFinding[]): void {
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= heap.length) return;
    const rightIndex = leftIndex + 1;
    let worstChildIndex = leftIndex;
    if (rightIndex < heap.length && compareFinding(heap[rightIndex], heap[leftIndex]) > 0) {
      worstChildIndex = rightIndex;
    }
    if (compareFinding(heap[index], heap[worstChildIndex]) >= 0) return;
    [heap[index], heap[worstChildIndex]] = [heap[worstChildIndex], heap[index]];
    index = worstChildIndex;
  }
}

export function createServerAuditBackupCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditBackupCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit backup-coverage maxFindings");
  const backups = snapshot.backups;
  if (backups === undefined || backups.length === 0) return [];

  const retainedFindings: ServerAuditFinding[] = [];
  let findingsObserved = 0;
  const recordFinding = (finding: ServerAuditFinding): void => {
    findingsObserved += 1;
    if (retainedFindings.length < maxFindings) {
      retainedFindings.push(finding);
      siftWorstFindingUp(retainedFindings, retainedFindings.length - 1);
      return;
    }
    if (compareFinding(finding, retainedFindings[0]) >= 0) return;
    retainedFindings[0] = finding;
    siftWorstFindingDown(retainedFindings);
  };

  backups.forEach((backup, index) => {
    if (backup.ageHours === undefined) {
      recordFinding({
        id: stableId(["backup-coverage", "missing-age", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Backup record lacks freshness evidence",
        summary: "A supplied backup record has no ageHours value, so freshness posture for that artifact cannot be established from this snapshot.",
        recommendation: "Re-collect backup inventory with the reviewed read-only collector before relying on backup freshness; verify restoreability separately against the workload's recovery objectives.",
        evidence: [{ source: `backups[${index}].ageHours`, summary: "freshness evidence is absent" }],
      });
    }
    if (backup.sizeBytes === undefined) {
      recordFinding({
        id: stableId(["backup-coverage", "missing-size", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Backup record lacks size evidence",
        summary: "A supplied backup record has no sizeBytes value, so zero-byte and artifact-size posture for that entry cannot be established from this snapshot.",
        recommendation: "Re-collect backup inventory with bounded size evidence before relying on artifact-size posture; verify backup success and restoreability separately.",
        evidence: [{ source: `backups[${index}].sizeBytes`, summary: "size evidence is absent" }],
      });
    }
  });

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["backup-coverage", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Backup evidence coverage findings were truncated",
    summary: `The backup-coverage stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from backup freshness or size evidence.",
    evidence: [{ source: "backups", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
