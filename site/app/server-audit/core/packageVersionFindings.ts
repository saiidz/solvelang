import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

export type ServerAuditPackageVersionFindingOptions = {
  maxFindings?: number;
};

const NON_SPECIFIC_VERSIONS = new Set([
  "unknown",
  "unavailable",
  "n/a",
  "na",
  "none",
  "latest",
  "current",
  "unspecified",
  "-",
  "?",
]);

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
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function createServerAuditPackageVersionFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditPackageVersionFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit package-version maxFindings");
  const packages = snapshot.packages;
  if (packages === undefined) return [];

  const candidates: ServerAuditFinding[] = [];
  if (packages.length === 0) {
    candidates.push({
      id: stableId(["package-version-evidence", "empty-inventory"]),
      severity: "info",
      category: "coverage",
      title: "No package records supplied",
      summary: "The snapshot contains an explicit empty package inventory, so installed-package and version posture cannot be evaluated from this evidence.",
      recommendation: "Re-collect the bounded package inventory with the reviewed read-only collector before relying on package or version posture. Do not infer vulnerability status from this finding; no advisory or CVE database was consulted.",
      evidence: [{ source: "packages", summary: "0 package records" }],
    });
  }

  packages.forEach((entry, index) => {
    const normalized = entry.version.trim().toLowerCase();
    const missing = normalized.length === 0;
    const nonSpecific = !missing && NON_SPECIFIC_VERSIONS.has(normalized);
    if (!missing && !nonSpecific) return;

    const kind = missing ? "missing" : "non-specific";
    candidates.push({
      id: stableId(["package-version-evidence", kind, String(index)]),
      severity: "info",
      category: "version-evidence",
      title: missing
        ? "Package inventory is missing concrete version evidence"
        : "Package inventory contains non-specific version evidence",
      summary: missing
        ? "A package record has no concrete version text, so version-specific posture cannot be established from this snapshot."
        : "A package record uses a placeholder or moving-label version rather than a concrete installed version, so version-specific posture cannot be established from this snapshot.",
      recommendation: "Re-collect package inventory with the reviewed read-only collector and preserve the package manager's concrete installed version. Do not infer vulnerability status from this finding; no advisory or CVE database was consulted.",
      evidence: [{
        source: `packages[${index}].version`,
        summary: missing ? "version text is empty" : "version text is non-specific",
      }],
    });
  });

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["package-version-evidence", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Package-version evidence findings were truncated",
    summary: `The package-version evidence stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from package-version evidence.",
    evidence: [{ source: "packages", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
