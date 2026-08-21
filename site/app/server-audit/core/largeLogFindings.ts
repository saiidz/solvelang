import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditLargeLogFindingOptions = {
  maxFindings?: number;
  thresholdBytes?: number;
};

const DEFAULT_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024;
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

export function createServerAuditLargeLogFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditLargeLogFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit large-log maxFindings");
  const thresholdBytes = boundedInteger(
    options.thresholdBytes,
    DEFAULT_THRESHOLD_BYTES,
    1,
    Number.MAX_SAFE_INTEGER,
    "Server Audit large-log thresholdBytes",
  );

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
    if (log.sizeBytes === undefined || log.sizeBytes < thresholdBytes) continue;
    recordFinding({
      id: stableId(["large-log", String(index), String(log.sizeBytes), String(thresholdBytes)]),
      severity: "medium",
      category: "logging",
      title: "Very large log file",
      summary: `Collected log entry ${index} is at least ${thresholdBytes} bytes and may threaten storage headroom if growth is not controlled.`,
      recommendation: "Verify log rotation, retention, compression, and disk alerts before logs threaten application availability.",
      evidence: [{ source: `logs[${index}].sizeBytes`, summary: `${log.sizeBytes} bytes` }],
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["large-log", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Large-log findings were truncated",
    summary: `The large-log stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from log-size evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
