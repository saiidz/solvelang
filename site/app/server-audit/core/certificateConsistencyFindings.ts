import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const MAX_FINDINGS = 100;
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function normalizedCertificateName(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

type CertificateEntry = NonNullable<NonNullable<ServerAuditSnapshot["web"]>["certificates"]>[number];

type IndexedCertificate = {
  index: number;
  certificate: CertificateEntry;
};

function firstConflictingPair<T>(
  entries: IndexedCertificate[],
  read: (entry: CertificateEntry) => T | undefined,
): [IndexedCertificate, IndexedCertificate] | undefined {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    const leftValue = read(left.certificate);
    if (leftValue === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      const rightValue = read(right.certificate);
      if (rightValue === undefined) continue;
      if (leftValue !== rightValue) return [left, right];
    }
  }
  return undefined;
}

function structuralPairKey(pair: [IndexedCertificate, IndexedCertificate]): string {
  return `${pair[0].index}:${pair[1].index}`;
}

function structuralEvidence(
  pair: [IndexedCertificate, IndexedCertificate],
  field: "notAfter" | "daysRemaining",
) {
  return pair.map(({ index }) => ({
    source: `web.certificates[${index}].${field}`,
    summary: `duplicate certificate identity ${field} evidence`,
  }));
}

export function createServerAuditCertificateConsistencyFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const certificates = snapshot.web?.certificates ?? [];
  const groups = new Map<string, IndexedCertificate[]>();

  certificates.forEach((certificate, index) => {
    const key = normalizedCertificateName(certificate.name);
    if (!key) return;
    const entries = groups.get(key) ?? [];
    entries.push({ index, certificate });
    groups.set(key, entries);
  });

  const candidates: ServerAuditFinding[] = [];
  for (const [, entries] of [...groups.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (entries.length < 2) continue;

    const expiryConflict = firstConflictingPair(entries, (entry) => entry.notAfter?.trim());
    if (expiryConflict) {
      candidates.push({
        id: stableId(["certificate-consistency", "not-after", structuralPairKey(expiryConflict)]),
        severity: "info",
        category: "evidence-integrity",
        title: "Duplicate certificate identity has conflicting expiry evidence",
        summary: "The supplied snapshot contains more than one certificate record for the same normalized identity with different explicit expiry timestamps. This can reflect renewal overlap or collection ambiguity, so the audit does not choose one value as authoritative.",
        recommendation: "Confirm which certificate record is active for the endpoint and re-collect a bounded snapshot before using expiry evidence for operational decisions.",
        evidence: structuralEvidence(expiryConflict, "notAfter"),
      });
    }

    const daysConflict = firstConflictingPair(entries, (entry) => entry.daysRemaining);
    if (daysConflict) {
      candidates.push({
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

  const sorted = candidates.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
  if (sorted.length <= MAX_FINDINGS) return sorted;

  const bounded = sorted.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["certificate-consistency", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Certificate consistency findings were truncated",
    summary: "The deterministic certificate-consistency stage reached its finding limit, so additional contradictory duplicate records may exist outside the emitted evidence.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before drawing a complete certificate-inventory conclusion.",
    evidence: [{ source: "web.certificates", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
