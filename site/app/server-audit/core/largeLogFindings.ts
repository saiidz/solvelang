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

  const candidates: ServerAuditFinding[] = [];
  for (const [index, log] of (snapshot.logs ?? []).entries()) {
    if (log.sizeBytes === undefined || log.sizeBytes < thresholdBytes) continue;
    candidates.push({
      id: stableId(["large-log", String(index), String(log.sizeBytes), String(thresholdBytes)]),
      severity: "medium",
      category: "logging",
      title: "Very large log file",
      summary: `Collected log entry ${index} is at least ${thresholdBytes} bytes and may threaten storage headroom if growth is not controlled.`,
      recommendation: "Verify log rotation, retention, compression, and disk alerts before logs threaten application availability.",
      evidence: [{ source: `logs[${index}].sizeBytes`, summary: `${log.sizeBytes} bytes` }],
    });
  }

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["large-log", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Large-log findings were truncated",
    summary: `The large-log stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from log-size evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
