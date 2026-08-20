import type { ServerAuditFinding, ServerAuditPublicFileMarker, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditPublicFileCoverageOptions = {
  maxFindings?: number;
};

const EXPECTED_MARKERS: ServerAuditPublicFileMarker[] = ["env-file", "git-config", "npmrc", "composer-auth"];
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

function hasAvailableRoot(roots: readonly unknown[], rootIndex: number): boolean {
  return Number.isInteger(rootIndex) && rootIndex >= 0 && rootIndex < roots.length && roots[rootIndex] !== undefined;
}

export function createServerAuditPublicFileCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditPublicFileCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit public-file coverage maxFindings");
  const roots = snapshot.web?.roots;
  const checks = snapshot.web?.publicFileChecks;
  if (roots === undefined || checks === undefined) return [];

  const candidates: ServerAuditFinding[] = [];
  const grouped = new Map<string, Array<{ index: number; present: boolean }>>();

  checks.forEach((check, index) => {
    if (!hasAvailableRoot(roots, check.rootIndex)) return;
    const key = `${check.rootIndex}\u001f${check.marker}`;
    const entries = grouped.get(key) ?? [];
    entries.push({ index, present: check.present });
    grouped.set(key, entries);
  });

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    if (!hasAvailableRoot(roots, rootIndex)) continue;
    const missing = EXPECTED_MARKERS.filter((marker) => !grouped.has(`${rootIndex}\u001f${marker}`));
    if (missing.length === 0) continue;
    candidates.push({
      id: stableId(["public-file-coverage", "missing-markers", String(rootIndex), ...missing]),
      severity: "info",
      category: "coverage",
      title: "Candidate web root has incomplete sensitive-file marker coverage",
      summary: `Candidate web root ${rootIndex} is missing ${missing.length} of the official collector's four fixed sensitive-file marker checks. Absence of a marker finding is therefore not complete evidence for this root.`,
      recommendation: "Re-collect the public-file marker section with the reviewed collector before treating missing marker findings as evidence that the candidate root is clear.",
      evidence: missing.map((marker) => ({ source: `web.roots[${rootIndex}]`, summary: `${marker} check absent` })),
    });
  }

  for (const [key, entries] of grouped.entries()) {
    if (entries.length < 2 || new Set(entries.map((entry) => entry.present)).size < 2) continue;
    const [rootIndex, marker] = key.split("\u001f");
    candidates.push({
      id: stableId(["public-file-coverage", "conflicting-marker", rootIndex, marker, ...entries.map((entry) => String(entry.index))]),
      severity: "low",
      category: "evidence-integrity",
      title: "Sensitive-file marker checks contradict each other",
      summary: "Duplicate checks for the same candidate web root and fixed marker disagree on local presence. This contradiction must be resolved before exposure conclusions are trusted.",
      recommendation: "Re-collect marker evidence in a single reviewed snapshot and verify collection timing before relying on either duplicate value.",
      evidence: entries.map((entry) => ({
        source: `web.publicFileChecks[${entry.index}].present`,
        summary: `duplicate ${marker} check has conflicting presence state`,
      })),
    });
  }

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["public-file-coverage", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Public-file coverage findings were truncated",
    summary: `The public-file coverage stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from public-file marker evidence.",
    evidence: [{ source: "web.publicFileChecks", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
