import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditLogCoverageOptions = {
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

export function createServerAuditLogCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditLogCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit log-coverage maxFindings");
  const logs = snapshot.logs;
  if (logs === undefined) return [];

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

  if (logs.length === 0) {
    recordFinding({
      id: stableId(["log-coverage", "empty-inventory"]),
      severity: "info",
      category: "coverage",
      title: "No log records supplied",
      summary: "The snapshot contains an explicit empty log inventory, so log size and activity posture cannot be evaluated from this evidence.",
      recommendation: "Re-collect a bounded log inventory with the reviewed read-only collector before relying on log posture conclusions.",
      evidence: [{ source: "logs", summary: "0 log records" }],
    });
  }

  logs.forEach((log, index) => {
    if (log.modifiedAt === undefined) {
      recordFinding({
        id: stableId(["log-coverage", "missing-modified-at", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Log record lacks activity timestamp evidence",
        summary: "A supplied log record has no modifiedAt value, so stale-log activity posture for that entry cannot be established from this snapshot.",
        recommendation: "Re-collect bounded log metadata with a modification timestamp before relying on stale-log activity posture.",
        evidence: [{ source: `logs[${index}].modifiedAt`, summary: "activity timestamp evidence is absent" }],
      });
    }
    if (log.sizeBytes === undefined) {
      recordFinding({
        id: stableId(["log-coverage", "missing-size", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Log record lacks size evidence",
        summary: "A supplied log record has no sizeBytes value, so large-log size posture for that entry cannot be established from this snapshot.",
        recommendation: "Re-collect bounded log metadata with size evidence before relying on large-log posture.",
        evidence: [{ source: `logs[${index}].sizeBytes`, summary: "size evidence is absent" }],
      });
    }
  });

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["log-coverage", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Log evidence coverage findings were truncated",
    summary: `The log-coverage stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from log activity or size evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
