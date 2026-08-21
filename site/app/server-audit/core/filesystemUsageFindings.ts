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

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

function usageFinding(index: number, usagePercent: number): ServerAuditFinding | undefined {
  let severity: ServerAuditSeverity;
  let title: string;
  let recommendation: string;

  if (usagePercent >= 95) {
    severity = "critical";
    title = "Filesystem critically full";
    recommendation = "Free or expand storage immediately and confirm log/cache growth is controlled.";
  } else if (usagePercent >= 90) {
    severity = "high";
    title = "Filesystem nearly full";
    recommendation = "Investigate disk growth, rotate or archive safe data, and restore operational headroom.";
  } else if (usagePercent >= 80) {
    severity = "medium";
    title = "Filesystem usage elevated";
    recommendation = "Review growth sources and establish an alert before the filesystem reaches an operational threshold.";
  } else {
    return undefined;
  }

  return {
    id: stableId(["filesystem-usage", title, String(index), String(usagePercent)]),
    severity,
    category: "storage",
    title,
    summary: `Collected filesystem record ${index} is ${usagePercent}% used.`,
    recommendation,
    evidence: [{ source: `filesystems[${index}].usagePercent`, summary: `${usagePercent}% used` }],
  };
}

export function createServerAuditFilesystemUsageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const candidates: ServerAuditFinding[] = [];

  for (const [index, filesystem] of (snapshot.filesystems ?? []).entries()) {
    if (filesystem.usagePercent === undefined) continue;
    const candidate = usageFinding(index, filesystem.usagePercent);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort(compareFinding);
  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["filesystem-usage", "findings-truncated", String(MAX_FINDINGS), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Filesystem usage findings were truncated",
    summary: `The filesystem-usage stage produced ${candidates.length} findings and emitted only the first ${MAX_FINDINGS - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from filesystem-usage evidence.",
    evidence: [{ source: "filesystems", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFinding);
}
