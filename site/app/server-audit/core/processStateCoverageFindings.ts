import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const MAX_FINDINGS = 100;
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFindings(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

function siftWorstFindingUp(heap: ServerAuditFinding[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareFindings(heap[parentIndex], heap[index]) >= 0) return;
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
    if (rightIndex < heap.length && compareFindings(heap[rightIndex], heap[leftIndex]) > 0) {
      worstChildIndex = rightIndex;
    }
    if (compareFindings(heap[index], heap[worstChildIndex]) >= 0) return;
    [heap[index], heap[worstChildIndex]] = [heap[worstChildIndex], heap[index]];
    index = worstChildIndex;
  }
}

function hasUsableState(state: string): boolean {
  return state.trim().normalize("NFC").length > 0;
}

export function createServerAuditProcessStateCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const retainedFindings: ServerAuditFinding[] = [];
  let findingsObserved = 0;

  const recordFinding = (finding: ServerAuditFinding): void => {
    findingsObserved += 1;
    if (retainedFindings.length < MAX_FINDINGS) {
      retainedFindings.push(finding);
      siftWorstFindingUp(retainedFindings, retainedFindings.length - 1);
      return;
    }
    if (compareFindings(finding, retainedFindings[0]) >= 0) return;
    retainedFindings[0] = finding;
    siftWorstFindingDown(retainedFindings);
  };

  for (const [index, process] of (snapshot.processes ?? []).entries()) {
    if (hasUsableState(process.state)) continue;
    const source = `processes[${index}].state`;
    recordFinding({
      id: stableId(["process-state-coverage", "unusable-state", source]),
      severity: "info",
      category: "coverage",
      title: "Process record lacks usable state evidence",
      summary: `Process evidence at processes[${index}] has no non-whitespace state value, so process-state conclusions cannot treat this record as having observed runtime state.`,
      recommendation: "Re-collect the bounded process inventory with the reviewed read-only collector before relying on process-state or lifecycle conclusions for this record.",
      evidence: [{ source, summary: "process state is empty after normalization" }],
    });
  }

  retainedFindings.sort(compareFindings);
  if (findingsObserved <= MAX_FINDINGS) return retainedFindings;

  const bounded = retainedFindings.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["process-state-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Process state coverage findings were truncated",
    summary: `The deterministic process-state coverage stage produced ${findingsObserved} findings and emitted only the first ${MAX_FINDINGS - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating process-state coverage as complete.",
    evidence: [{ source: "processes", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
