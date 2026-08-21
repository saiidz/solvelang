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

type CoverageGap = {
  key: SystemMetric["key"];
  summary: "metric missing" | "load vector incomplete";
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
  const gaps: CoverageGap[] = metrics
    .filter((metric) => metric.value === undefined)
    .map((metric) => ({ key: metric.key, summary: "metric missing" }));
  const partialLoad = system.load !== undefined && system.load.length !== 3;
  if (partialLoad) gaps.push({ key: "load", summary: "load vector incomplete" });
  if (gaps.length === 0) return [];

  const evidence = gaps.map((gap) => ({
    source: `system.${gap.key}`,
    summary: gap.summary,
  }));

  return [{
    id: stableId([
      "system-metrics-coverage",
      String(gaps.length),
      ...evidence.map((item) => item.source),
      ...(partialLoad ? ["load-arity"] : []),
    ]),
    severity: "info",
    category: "coverage",
    title: "System telemetry evidence is incomplete",
    summary: partialLoad
      ? `${gaps.length} of ${metrics.length} bounded system metric(s) are missing or incomplete, so uptime, load, and memory posture cannot be treated as complete from this snapshot.`
      : `${gaps.length} of ${metrics.length} bounded system metric(s) are absent, so uptime, load, and memory posture cannot be treated as complete from this snapshot.`,
    recommendation: "Re-collect the bounded system telemetry with the reviewed read-only collector before treating absent or incomplete uptime, load, or memory evidence as healthy or authoritative.",
    evidence,
  }];
}
