import type { ServerAuditFinding, ServerAuditPublicFileMarker, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditPublicFileCoverageOptions = {
  maxFindings?: number;
};

const EXPECTED_MARKERS: ServerAuditPublicFileMarker[] = ["env-file", "git-config", "npmrc", "composer-auth"];
const MAX_CONTRADICTION_EVIDENCE = 32;
const STABLE_HASH_OFFSET = 2166136261;
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

type PublicFileCheckEvidence = {
  index: number;
  present: boolean;
};

type PublicFileCheckGroup = {
  rootIndex: number;
  marker: ServerAuditPublicFileMarker;
  entriesObserved: number;
  presentObserved: boolean;
  absentObserved: boolean;
  identityHash: number;
  evidenceEntries: PublicFileCheckEvidence[];
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function updateStableHash(hash: number, input: string): number {
  let next = hash;
  for (let index = 0; index < input.length; index += 1) {
    next ^= input.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

function stableHash(parts: readonly string[]): number {
  let hash = STABLE_HASH_OFFSET;
  parts.forEach((part, index) => {
    if (index > 0) hash = updateStableHash(hash, "\u001f");
    hash = updateStableHash(hash, part);
  });
  return hash;
}

function appendStableHashPart(hash: number, part: string): number {
  return updateStableHash(updateStableHash(hash, "\u001f"), part);
}

function stableId(parts: string[]): string {
  return stableIdFromHash(stableHash(parts));
}

function stableIdFromHash(hash: number): string {
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

function hasAvailableRoot(roots: readonly unknown[], rootIndex: number): boolean {
  return Number.isInteger(rootIndex) && rootIndex >= 0 && rootIndex < roots.length && roots[rootIndex] !== undefined;
}

function retainContradictionEvidence(group: PublicFileCheckGroup, entry: PublicFileCheckEvidence): void {
  if (group.evidenceEntries.length < MAX_CONTRADICTION_EVIDENCE) {
    group.evidenceEntries.push(entry);
    return;
  }
  if (group.evidenceEntries.some((retained) => retained.present === entry.present)) return;
  group.evidenceEntries[group.evidenceEntries.length - 1] = entry;
}

function boundedContradictionEvidence(group: PublicFileCheckGroup): ServerAuditFinding["evidence"] {
  const evidenceTruncated = group.entriesObserved > MAX_CONTRADICTION_EVIDENCE;
  const witnessLimit = evidenceTruncated ? MAX_CONTRADICTION_EVIDENCE - 1 : MAX_CONTRADICTION_EVIDENCE;
  const retained = group.evidenceEntries.slice(0, witnessLimit);
  if (group.presentObserved && group.absentObserved && new Set(retained.map((entry) => entry.present)).size < 2) {
    const opposite = group.evidenceEntries.find((entry) => entry.present !== retained[0]?.present);
    if (opposite !== undefined && retained.length > 0) retained[retained.length - 1] = opposite;
  }

  const evidence = retained.map((entry) => ({
    source: `web.publicFileChecks[${entry.index}].present`,
    summary: `duplicate ${group.marker} check has conflicting presence state`,
  }));
  if (evidenceTruncated) {
    evidence.push({
      source: "web.publicFileChecks",
      summary: `duplicate evidence bounded to ${witnessLimit} of ${group.entriesObserved} structural witnesses`,
    });
  }
  return evidence;
}

export function createServerAuditPublicFileCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditPublicFileCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit public-file coverage maxFindings");
  const roots = snapshot.web?.roots;
  const checks = snapshot.web?.publicFileChecks;
  if (roots === undefined || checks === undefined) return [];

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

  const grouped = new Map<string, PublicFileCheckGroup>();
  checks.forEach((check, index) => {
    if (!hasAvailableRoot(roots, check.rootIndex)) return;
    const key = `${check.rootIndex}\u001f${check.marker}`;
    let group = grouped.get(key);
    if (group === undefined) {
      group = {
        rootIndex: check.rootIndex,
        marker: check.marker,
        entriesObserved: 0,
        presentObserved: false,
        absentObserved: false,
        identityHash: stableHash(["public-file-coverage", "conflicting-marker", String(check.rootIndex), check.marker]),
        evidenceEntries: [],
      };
      grouped.set(key, group);
    }
    group.entriesObserved += 1;
    group.presentObserved ||= check.present;
    group.absentObserved ||= !check.present;
    group.identityHash = appendStableHashPart(group.identityHash, String(index));
    retainContradictionEvidence(group, { index, present: check.present });
  });

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    if (!hasAvailableRoot(roots, rootIndex)) continue;
    const missing = EXPECTED_MARKERS.filter((marker) => !grouped.has(`${rootIndex}\u001f${marker}`));
    if (missing.length === 0) continue;
    recordFinding({
      id: stableId(["public-file-coverage", "missing-markers", String(rootIndex), ...missing]),
      severity: "info",
      category: "coverage",
      title: "Candidate web root has incomplete sensitive-file marker coverage",
      summary: `Candidate web root ${rootIndex} is missing ${missing.length} of the official collector's four fixed sensitive-file marker checks. Absence of a marker finding is therefore not complete evidence for this root.`,
      recommendation: "Re-collect the public-file marker section with the reviewed collector before treating missing marker findings as evidence that the candidate root is clear.",
      evidence: missing.map((marker) => ({ source: `web.roots[${rootIndex}]`, summary: `${marker} check absent` })),
    });
  }

  for (const group of grouped.values()) {
    if (group.entriesObserved < 2 || !group.presentObserved || !group.absentObserved) continue;
    recordFinding({
      id: stableIdFromHash(group.identityHash),
      severity: "low",
      category: "evidence-integrity",
      title: "Sensitive-file marker checks contradict each other",
      summary: "Duplicate checks for the same candidate web root and fixed marker disagree on local presence. This contradiction must be resolved before exposure conclusions are trusted.",
      recommendation: "Re-collect marker evidence in a single reviewed snapshot and verify collection timing before relying on either duplicate value.",
      evidence: boundedContradictionEvidence(group),
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["public-file-coverage", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Public-file coverage findings were truncated",
    summary: `The public-file coverage stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from public-file marker evidence.",
    evidence: [{ source: "web.publicFileChecks", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
