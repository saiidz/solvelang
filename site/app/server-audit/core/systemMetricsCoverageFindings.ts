import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

type SystemMetric = {
  key: "uptimeSeconds" | "load" | "memoryTotalBytes" | "memoryAvailableBytes";
  value: unknown;
};

export function createServerAuditSystemMetricsCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const system = snapshot.system;
  if (system === undefined) return [];

  const metrics: SystemMetric[] = [
    { key: "uptimeSeconds", value: system.uptimeSeconds },
    { key: "load", value: system.load },
    { key: "memoryTotalBytes", value: system.memoryTotalBytes },
    { key: "memoryAvailableBytes", value: system.memoryAvailableBytes },
  ];
  const missing = metrics.filter((metric) => metric.value === undefined);
  if (missing.length === 0) return [];

  const evidence = missing.map((metric) => ({
    source: `system.${metric.key}`,
    summary: "metric missing",
  }));

  return [{
    id: stableId([
      "system-metrics-coverage",
      String(missing.length),
      ...evidence.map((item) => item.source),
    ]),
    severity: "info",
    category: "coverage",
    title: "System telemetry evidence is incomplete",
    summary: `${missing.length} of ${metrics.length} bounded system metric(s) are absent, so uptime, load, and memory posture cannot be treated as complete from this snapshot.`,
    recommendation: "Re-collect the bounded system telemetry with the reviewed read-only collector before treating absent uptime, load, or memory evidence as healthy or authoritative.",
    evidence,
  }];
}
