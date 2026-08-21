import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditStaleLogFindingOptions = {
  maxFindings?: number;
  staleAfterHours?: number;
};

const DEFAULT_STALE_AFTER_HOURS = 168;
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = boundedNumber(value, fallback, minimum, maximum, label);
  if (!Number.isSafeInteger(resolved)) throw new Error(`${label} must be an integer.`);
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

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

export function createServerAuditStaleLogFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditStaleLogFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit stale-log maxFindings");
  const staleAfterHours = boundedNumber(
    options.staleAfterHours,
    DEFAULT_STALE_AFTER_HOURS,
    1,
    24 * 365 * 10,
    "Server Audit stale-log staleAfterHours",
  );
  const collectedAt = timestamp(snapshot.collectedAt);
  if (collectedAt === undefined) return [];

  const thresholdMs = staleAfterHours * 60 * 60 * 1_000;
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

  for (const [index, log] of (snapshot.logs ?? []).entries()) {
    const modifiedAt = timestamp(log.modifiedAt);
    if (modifiedAt === undefined || modifiedAt > collectedAt || collectedAt - modifiedAt <= thresholdMs) continue;
    recordFinding({
      id: stableId(["stale-log", String(index), String(modifiedAt), String(collectedAt), String(staleAfterHours)]),
      severity: "low",
      category: "logging",
      title: "Log activity appears stale relative to the snapshot",
      summary: `Collected log entry ${index} has no observed modification within the configured ${staleAfterHours}-hour window and is a review candidate. This metadata alone does not prove a rotation failure, inactive service, or missing logs.`,
      recommendation: "Confirm whether the workload normally emits this log, then review rotation and retention configuration with bounded operational evidence before taking action.",
      evidence: [{ source: `logs[${index}].modifiedAt`, summary: `older than ${staleAfterHours} hours` }],
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;
  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["stale-log", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Stale-log candidates were truncated",
    summary: `The stale-log stage produced ${findingsObserved} candidates and emitted only the first ${maxFindings - 1} deterministic candidates plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from stale-log candidate evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
