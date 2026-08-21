import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const MAX_WEB_ROOT_PERMISSION_COVERAGE_EVIDENCE = 100;

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function boundedCoverageEvidence(ownerIndexes: number[], modeIndexes: number[]) {
  const evidence: Array<{ source: string; summary: string }> = [];
  let ownerCursor = 0;
  let modeCursor = 0;

  while (
    evidence.length < MAX_WEB_ROOT_PERMISSION_COVERAGE_EVIDENCE
    && (ownerCursor < ownerIndexes.length || modeCursor < modeIndexes.length)
  ) {
    if (ownerCursor < ownerIndexes.length && evidence.length < MAX_WEB_ROOT_PERMISSION_COVERAGE_EVIDENCE) {
      const index = ownerIndexes[ownerCursor];
      ownerCursor += 1;
      evidence.push({
        source: `web.roots[${index}].owner`,
        summary: "owner missing or blank",
      });
    }
    if (modeCursor < modeIndexes.length && evidence.length < MAX_WEB_ROOT_PERMISSION_COVERAGE_EVIDENCE) {
      const index = modeIndexes[modeCursor];
      modeCursor += 1;
      evidence.push({
        source: `web.roots[${index}].mode`,
        summary: "mode missing",
      });
    }
  }

  return evidence;
}

export function createServerAuditWebRootPermissionCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const roots = snapshot.web?.roots;
  if (roots === undefined || roots.length === 0) return [];

  const missingOwnerIndexes = roots
    .map((root, index) => (root.owner === undefined || root.owner.trim().length === 0 ? index : undefined))
    .filter((index): index is number => index !== undefined);
  const missingModeIndexes = roots
    .map((root, index) => (root.mode === undefined ? index : undefined))
    .filter((index): index is number => index !== undefined);

  if (missingOwnerIndexes.length === 0 && missingModeIndexes.length === 0) return [];

  const evidence = boundedCoverageEvidence(missingOwnerIndexes, missingModeIndexes);
  const totalMissingEvidence = missingOwnerIndexes.length + missingModeIndexes.length;
  const evidenceTruncated = totalMissingEvidence > evidence.length;

  return [{
    id: stableId([
      "web-root-permission-coverage",
      String(roots.length),
      String(missingOwnerIndexes.length),
      String(missingModeIndexes.length),
      ...evidence.map((item) => item.source),
    ]),
    severity: "info",
    category: "coverage",
    title: "Web-root ownership or permission evidence is incomplete",
    summary: `${missingOwnerIndexes.length} of ${roots.length} supplied web-root record(s) lack usable owner evidence and ${missingModeIndexes.length} lack mode evidence, so ownership and permission review is incomplete.${evidenceTruncated ? ` Only the first ${evidence.length} structural reference(s) are included.` : ""}`,
    recommendation: "Re-collect the bounded web-root inventory with the reviewed read-only collector before treating the absence of ownership or permission findings as evidence that candidate web roots are correctly owned and protected.",
    evidence,
  }];
}
