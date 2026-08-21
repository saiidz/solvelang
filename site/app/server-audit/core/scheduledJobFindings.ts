import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditScheduledJobFindingOptions = {
  maxFindings?: number;
};

const REDACTED_COMMAND_SUMMARY = "command content intentionally not collected";
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

export function createServerAuditScheduledJobFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditScheduledJobFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit scheduled-job maxFindings");
  const jobs = snapshot.scheduledJobs;
  if (jobs === undefined) return [];

  const retainedFindings: ServerAuditFinding[] = [];
  let findingsObserved = 0;
  const sourceIndexes = new Map<string, number[]>();

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

  jobs.forEach((job, index) => {
    const indexes = sourceIndexes.get(job.source) ?? [];
    indexes.push(index);
    sourceIndexes.set(job.source, indexes);

    if (job.commandSummary !== REDACTED_COMMAND_SUMMARY) {
      recordFinding({
        id: stableId(["scheduled-job", "command-summary-unverified", String(index)]),
        severity: "medium",
        category: "privacy",
        title: "Scheduled-job command summary is not verified redacted",
        summary: "A scheduled-job record contains command-summary text that does not match the official collector's fixed redacted placeholder. This stage does not echo or interpret that text.",
        recommendation: "Re-collect scheduled-job evidence with the reviewed collector or replace the command summary with a reviewed non-sensitive structural description before sharing the snapshot.",
        evidence: [{ source: `scheduledJobs[${index}].commandSummary`, summary: "non-placeholder command summary withheld" }],
      });
    }
  });

  for (const indexes of sourceIndexes.values()) {
    if (indexes.length < 2) continue;
    const signatures = new Set(indexes.map((index) => {
      const job = jobs[index];
      return `${job.schedule ?? ""}\u001f${job.commandSummary}`;
    }));
    if (signatures.size < 2) continue;
    const [firstIndex, ...rest] = indexes;
    recordFinding({
      id: stableId(["scheduled-job", "conflicting-duplicate-source", ...indexes.map(String)]),
      severity: "info",
      category: "evidence-integrity",
      title: "Scheduled-job inventory reports conflicting duplicate evidence",
      summary: "Multiple scheduled-job records refer to the same collected source but disagree on schedule or redacted command-summary metadata. The source value is intentionally withheld from the finding.",
      recommendation: "Re-collect scheduled-job inventory with the reviewed collector before relying on the duplicated record for operational conclusions.",
      evidence: [firstIndex, ...rest].map((index) => ({
        source: `scheduledJobs[${index}]`,
        summary: "conflicting duplicate source record",
      })),
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["scheduled-job", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Scheduled-job findings were truncated",
    summary: `The scheduled-job stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from scheduled-job evidence.",
    evidence: [{ source: "scheduledJobs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
