import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const MAX_FINDINGS = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

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

function parseTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function derivedFinding(
  index: number,
  deltaMs: number,
): ServerAuditFinding | undefined {
  const source = `web.certificates[${index}].notAfter`;
  if (deltaMs < 0) {
    const daysAgo = Math.max(1, Math.ceil(Math.abs(deltaMs) / DAY_MS));
    return {
      id: stableId(["certificate-expiry-fallback", "expired", source]),
      severity: "critical",
      category: "tls",
      title: "TLS certificate expired",
      summary: `Certificate expiry evidence at web.certificates[${index}] is about ${daysAgo} day(s) before the supplied snapshot collection time.`,
      recommendation: "Confirm which certificate is active, renew or replace it if needed, and verify the served chain through a separately approved endpoint check before relying on this snapshot alone.",
      evidence: [{ source, summary: "expiry window derived from notAfter because daysRemaining was absent" }],
    };
  }

  const daysRemaining = Math.ceil(deltaMs / DAY_MS);
  if (deltaMs <= 7 * DAY_MS) {
    return {
      id: stableId(["certificate-expiry-fallback", "seven-days", source]),
      severity: "high",
      category: "tls",
      title: "TLS certificate expires within seven days",
      summary: `Certificate expiry evidence at web.certificates[${index}] is about ${daysRemaining} day(s) after the supplied snapshot collection time.`,
      recommendation: "Confirm renewal automation and the active certificate before the expiry window closes; this read-only evidence does not verify endpoint reachability.",
      evidence: [{ source, summary: "expiry window derived from notAfter because daysRemaining was absent" }],
    };
  }

  if (deltaMs <= 30 * DAY_MS) {
    return {
      id: stableId(["certificate-expiry-fallback", "thirty-days", source]),
      severity: "medium",
      category: "tls",
      title: "TLS certificate approaching expiry",
      summary: `Certificate expiry evidence at web.certificates[${index}] is about ${daysRemaining} day(s) after the supplied snapshot collection time.`,
      recommendation: "Verify renewal automation and alerting before the certificate enters the critical window; this read-only evidence does not prove which certificate is actively served.",
      evidence: [{ source, summary: "expiry window derived from notAfter because daysRemaining was absent" }],
    };
  }

  return undefined;
}

export function createServerAuditCertificateExpiryFallbackFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const collectedAt = parseTimestamp(snapshot.collectedAt);
  if (collectedAt === undefined) return [];

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

  for (const [index, certificate] of (snapshot.web?.certificates ?? []).entries()) {
    if (certificate.daysRemaining !== undefined || certificate.notAfter === undefined) continue;
    const notAfter = parseTimestamp(certificate.notAfter);
    if (notAfter === undefined) continue;
    const finding = derivedFinding(index, notAfter - collectedAt);
    if (finding !== undefined) recordFinding(finding);
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= MAX_FINDINGS) return retainedFindings;

  const bounded = retainedFindings.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["certificate-expiry-fallback", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Certificate expiry fallback findings were truncated",
    summary: "The deterministic certificate-expiry fallback reached its finding limit, so additional supplied expiry timestamps may fall inside an alert window outside the emitted evidence.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating certificate-expiry coverage as complete.",
    evidence: [{ source: "web.certificates", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFinding);
}
