import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

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

export function createServerAuditProcessFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditProcessFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit process maxFindings");
  const processes = snapshot.processes;
  if (processes === undefined) return [];

  const findings: ServerAuditFinding[] = [];
  const pids = new Set(processes.map((process) => process.pid));
  const processNames = new Set(processes.map((process) => process.name));

  for (const process of [...processes].sort((left, right) => left.pid - right.pid || left.name.localeCompare(right.name))) {
    if (/^Z/i.test(process.state)) {
      findings.push({
        id: stableId(["process", "zombie", String(process.pid), process.name, process.state]),
        severity: "low",
        category: "process",
        title: "Zombie process observed",
        summary: `PID ${process.pid} (${process.name}) was collected in state ${process.state}. A single snapshot does not prove the condition is persistent.`,
        recommendation: "Confirm the process remains in a zombie state across repeated read-only snapshots, then inspect its parent or owning service before making any change.",
        evidence: [{ source: `pid:${process.pid}`, summary: `${process.name} state ${process.state}` }],
      });
    }

    if (process.ppid > 1 && !pids.has(process.ppid)) {
      findings.push({
        id: stableId(["process", "parent-missing", String(process.pid), String(process.ppid)]),
        severity: "info",
        category: "evidence-integrity",
        title: "Process parent is outside collected inventory",
        summary: `PID ${process.pid} references parent PID ${process.ppid}, which is not present in the supplied process inventory. Collection limits or process churn may explain the gap.`,
        recommendation: "Re-collect the bounded process inventory before using this parent relationship for operational or security conclusions.",
        evidence: [{ source: `pid:${process.pid}`, summary: `parent pid ${process.ppid} not collected` }],
      });
    }
  }

  for (const socket of [...(snapshot.listeningSockets ?? [])].sort(
    (left, right) => left.protocol.localeCompare(right.protocol)
      || left.localAddress.localeCompare(right.localAddress)
      || left.port - right.port
      || (left.process ?? "").localeCompare(right.process ?? ""),
  )) {
    if (!socket.process || processNames.has(socket.process)) continue;
    findings.push({
      id: stableId(["process", "listener-name-missing", socket.protocol, socket.localAddress, String(socket.port), socket.process]),
      severity: "info",
      category: "evidence-integrity",
      title: "Listener process is outside collected process inventory",
      summary: `${socket.protocol}/${socket.port} reports process ${socket.process}, but that executable name is not present in the supplied process inventory. Collection timing or visibility may explain the mismatch.`,
      recommendation: "Re-collect socket and process evidence from the same reviewed collector run before attributing ownership of this listener.",
      evidence: [{ source: `${socket.protocol}/${socket.port}`, summary: `listener process ${socket.process} not collected` }],
    });
  }

  findings.sort(compareFinding);
  if (findings.length <= maxFindings) return findings;

  const bounded = findings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["process", "findings-truncated", String(maxFindings), String(findings.length)]),
    severity: "info",
    category: "coverage",
    title: "Process relationship findings were truncated",
    summary: `The process health stage produced ${findings.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from process relationship evidence.",
    evidence: [{ source: "processes", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
