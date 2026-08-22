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

function normalizedCertificateName(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

type ObservedValue<T> = {
  index: number;
  value: T;
};

type CertificateGroupState = {
  firstNotAfter?: ObservedValue<string>;
  notAfterConflict?: [number, number];
  firstDaysRemaining?: ObservedValue<number>;
  daysRemainingConflict?: [number, number];
};

function structuralPairKey(pair: [number, number]): string {
  return `${pair[0]}:${pair[1]}`;
}

function structuralEvidence(
  pair: [number, number],
  field: "notAfter" | "daysRemaining",
) {
  return pair.map((index) => ({
    source: `web.certificates[${index}].${field}`,
    summary: `duplicate certificate identity ${field} evidence`,
  }));
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

function observeValue<T>(
  state: CertificateGroupState,
  index: number,
  value: T | undefined,
  firstKey: "firstNotAfter" | "firstDaysRemaining",
  conflictKey: "notAfterConflict" | "daysRemainingConflict",
): void {
  if (value === undefined || state[conflictKey] !== undefined) return;
  const first = state[firstKey] as ObservedValue<T> | undefined;
  if (first === undefined) {
    (state as Record<string, unknown>)[firstKey] = { index, value };
    return;
  }
  if (first.value !== value) state[conflictKey] = [first.index, index];
}

export function createServerAuditCertificateConsistencyFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const groups = new Map<string, CertificateGroupState>();

  (snapshot.web?.certificates ?? []).forEach((certificate, index) => {
    const key = normalizedCertificateName(certificate.name);
    if (!key) return;
    const state = groups.get(key) ?? {};
    observeValue(state, index, certificate.notAfter?.trim(), "firstNotAfter", "notAfterConflict");
    observeValue(state, index, certificate.daysRemaining, "firstDaysRemaining", "daysRemainingConflict");
    groups.set(key, state);
  });

  const retainedFindings: ServerAuditFinding[] = [];
  let findingsObserved = 0;
  const recordFinding = (finding: ServerAuditFinding): void => {
    findingsObserved += 1;
    if (retainedFindings.length < MAX_FINDINGS) {
      retainedFindings.push(finding);
      siftWorstFindingUp(retainedFindings, retainedFindings.length - 1);
      return;
    }
    if (compareFinding(finding, retainedFindings[0]) >= 0) return;
    retainedFindings[0] = finding;
    siftWorstFindingDown(retainedFindings);
  };

  for (const state of groups.values()) {
    const expiryConflict = state.notAfterConflict;
    if (expiryConflict) {
      recordFinding({
        id: stableId(["certificate-consistency", "not-after", structuralPairKey(expiryConflict)]),
        severity: "info",
        category: "evidence-integrity",
        title: "Duplicate certificate identity has conflicting expiry evidence",
        summary: "The supplied snapshot contains more than one certificate record for the same normalized identity with different explicit expiry timestamps. This can reflect renewal overlap or collection ambiguity, so the audit does not choose one value as authoritative.",
        recommendation: "Confirm which certificate record is active for the endpoint and re-collect a bounded snapshot before using expiry evidence for operational decisions.",
        evidence: structuralEvidence(expiryConflict, "notAfter"),
      });
    }

    const daysConflict = state.daysRemainingConflict;
    if (daysConflict) {
      recordFinding({
        id: stableId(["certificate-consistency", "days-remaining", structuralPairKey(daysConflict)]),
        severity: "info",
        category: "evidence-integrity",
        title: "Duplicate certificate identity has conflicting remaining-days evidence",
        summary: "The supplied snapshot contains more than one certificate record for the same normalized identity with different explicit remaining-day values. The audit treats this as contradictory snapshot evidence rather than selecting a value.",
        recommendation: "Re-collect the certificate inventory and confirm that one consistent active-certificate record is emitted for each endpoint identity.",
        evidence: structuralEvidence(daysConflict, "daysRemaining"),
      });
    }
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= MAX_FINDINGS) return retainedFindings;

  const bounded = retainedFindings.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["certificate-consistency", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Certificate consistency findings were truncated",
    summary: "The deterministic certificate-consistency stage reached its finding limit, so additional contradictory duplicate records may exist outside the emitted evidence.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before drawing a complete certificate-inventory conclusion.",
    evidence: [{ source: "web.certificates", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFinding);
}
