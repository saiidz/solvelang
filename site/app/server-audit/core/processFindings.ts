import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";
import { createServerAuditProcessStateCoverageFindings } from "./processStateCoverageFindings";

export type ServerAuditProcessFindingOptions = {
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

export function createServerAuditProcessFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditProcessFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit process maxFindings");
  const processes = snapshot.processes;
  if (processes === undefined) return [];

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

  for (const finding of createServerAuditProcessStateCoverageFindings(snapshot)) {
    recordFinding(finding);
  }

  const pids = new Set(processes.map((process) => process.pid));
  const processNames = new Set(processes.map((process) => process.name));
  const indexedProcesses = processes.map((process, index) => ({ process, index }));

  for (const { process, index } of [...indexedProcesses].sort(
    (left, right) => left.process.pid - right.process.pid
      || left.process.name.localeCompare(right.process.name)
      || left.index - right.index,
  )) {
    if (/^Z/i.test(process.state)) {
      const source = `processes[${index}].state`;
      recordFinding({
        id: stableId(["process", "zombie", source]),
        severity: "low",
        category: "process",
        title: "Zombie process observed",
        summary: `Process evidence at processes[${index}] was collected in a zombie-prefixed state. A single snapshot does not prove the condition is persistent.`,
        recommendation: "Confirm the process remains in a zombie state across repeated read-only snapshots, then inspect its parent or owning service before making any change.",
        evidence: [{ source, summary: "process state begins with a zombie marker" }],
      });
    }

    if (process.ppid > 1 && !pids.has(process.ppid)) {
      const source = `processes[${index}].ppid`;
      recordFinding({
        id: stableId(["process", "parent-missing", source]),
        severity: "info",
        category: "evidence-integrity",
        title: "Process parent is outside collected inventory",
        summary: `Process evidence at processes[${index}] references a parent PID that is not present in the supplied process inventory. Collection limits or process churn may explain the gap.`,
        recommendation: "Re-collect the bounded process inventory before using this parent relationship for operational or security conclusions.",
        evidence: [{ source, summary: "referenced parent PID was not collected" }],
      });
    }
  }

  const indexedSockets = (snapshot.listeningSockets ?? []).map((socket, index) => ({ socket, index }));
  for (const { socket, index } of [...indexedSockets].sort(
    (left, right) => left.socket.protocol.localeCompare(right.socket.protocol)
      || left.socket.localAddress.localeCompare(right.socket.localAddress)
      || left.socket.port - right.socket.port
      || (left.socket.process ?? "").localeCompare(right.socket.process ?? "")
      || left.index - right.index,
  )) {
    if (!socket.process || processNames.has(socket.process)) continue;
    const source = `listeningSockets[${index}].process`;
    recordFinding({
      id: stableId(["process", "listener-name-missing", source]),
      severity: "info",
      category: "evidence-integrity",
      title: "Listener process is outside collected process inventory",
      summary: `Listener evidence at listeningSockets[${index}] names a process that is not present in the supplied process inventory. Collection timing or visibility may explain the mismatch.`,
      recommendation: "Re-collect socket and process evidence from the same reviewed collector run before attributing ownership of this listener.",
      evidence: [{ source, summary: "listener process identity was not collected in process inventory" }],
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["process", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Process relationship findings were truncated",
    summary: `The process health stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from process relationship evidence.",
    evidence: [{ source: "processes", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
