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

function usable(value: string): boolean {
  return value.trim().normalize("NFC").length > 0;
}

export function createServerAuditWebIdentityCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
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

  for (let index = 0; index < (snapshot.web?.servers?.length ?? 0); index += 1) {
    const server = snapshot.web!.servers![index] as unknown;
    if (typeof server !== "string" || usable(server)) continue;
    const source = `web.servers[${index}]`;
    recordFinding({
      id: stableId(["web-identity-coverage", "server", source]),
      severity: "info",
      category: "coverage",
      title: "Web-server record lacks a usable identity",
      summary: `Web-server evidence at web.servers[${index}] has no non-whitespace identity, so service/listener correlation cannot use this record reliably.`,
      recommendation: "Re-collect the bounded local web-server inventory with a stable static service identity before relying on web-server correlation or inventory conclusions.",
      evidence: [{ source, summary: "web-server identity is empty after normalization" }],
    });
  }

  for (let index = 0; index < (snapshot.web?.roots?.length ?? 0); index += 1) {
    const root = snapshot.web!.roots![index] as unknown;
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const path = (root as { path?: unknown }).path;
    if (typeof path !== "string" || usable(path)) continue;
    const source = `web.roots[${index}].path`;
    recordFinding({
      id: stableId(["web-identity-coverage", "root", source]),
      severity: "info",
      category: "coverage",
      title: "Web-root record lacks a usable path identity",
      summary: `Web-root evidence at web.roots[${index}] has no non-whitespace path identity, so permission, framework-hint, and public-file attribution cannot use this record reliably.`,
      recommendation: "Re-collect the bounded local web-root inventory with an explicit stable path before relying on root-permission, framework-hint, or public-file conclusions.",
      evidence: [{ source, summary: "web-root path identity is empty after normalization" }],
    });
  }

  retainedFindings.sort(compareFindings);
  if (findingsObserved <= MAX_FINDINGS) return retainedFindings;

  const bounded = retainedFindings.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["web-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Web identity coverage findings were truncated",
    summary: `The deterministic web-identity coverage stage produced ${findingsObserved} findings and emitted only the first ${MAX_FINDINGS - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating web identity coverage as complete.",
    evidence: [{ source: "web", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
