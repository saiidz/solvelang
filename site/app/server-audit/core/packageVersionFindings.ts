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

export function createServerAuditPackageVersionFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditPackageVersionFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit package-version maxFindings");
  const packages = snapshot.packages;
  if (packages === undefined) return [];

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

  if (packages.length === 0) {
    recordFinding({
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
    recordFinding({
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

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["package-version-evidence", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Package-version evidence findings were truncated",
    summary: `The package-version evidence stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from package-version evidence.",
    evidence: [{ source: "packages", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
