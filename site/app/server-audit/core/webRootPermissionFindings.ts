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

function permissionDigits(mode: string): [number, number, number] | undefined {
  if (!/^[0-7]{3,4}$/.test(mode)) return undefined;
  const digits = mode.slice(-3).split("").map((digit) => Number(digit));
  return [digits[0], digits[1], digits[2]];
}

function permissionEvidence(index: number, includeOwner: boolean) {
  const evidence = [{ source: `web.roots[${index}].mode`, summary: "candidate web-root permission evidence" }];
  if (includeOwner) evidence.push({ source: `web.roots[${index}].owner`, summary: "candidate web-root ownership evidence" });
  return evidence;
}

function privilegedOwnerEvidence(index: number) {
  return [
    { source: `web.roots[${index}].owner`, summary: "candidate web-root ownership evidence" },
    { source: `web.roots[${index}].frameworkHints`, summary: "application framework evidence" },
  ];
}

export function createServerAuditWebRootPermissionFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const roots = snapshot.web?.roots ?? [];
  const candidates: ServerAuditFinding[] = [];

  roots.forEach((root, index) => {
    if (root.mode !== undefined) {
      const digits = permissionDigits(root.mode);
      if (!digits) {
        candidates.push({
          id: stableId(["web-root-permissions", "unparseable-mode", String(index)]),
          severity: "info",
          category: "evidence-integrity",
          title: "Web-root permission evidence is not interpretable",
          summary: "A candidate web root includes mode evidence that is not a three- or four-digit octal permission value, so this stage does not infer write exposure from it.",
          recommendation: "Re-collect the snapshot with the reviewed collector before drawing a filesystem-permission conclusion for this web root.",
          evidence: [{ source: `web.roots[${index}].mode`, summary: "uninterpretable candidate web-root mode evidence" }],
        });
      } else {
        const [, group, other] = digits;
        const ownerEvidencePresent = root.owner !== undefined;
        if ((other & 0b010) !== 0) {
          candidates.push({
            id: stableId(["web-root-permissions", "world-writable", String(index)]),
            severity: "high",
            category: "permissions",
            title: "Candidate web root is world-writable",
            summary: "Collected permission evidence indicates that a candidate web root allows writes by users outside its owner and group. This is a strong local-integrity risk when less-trusted users or processes share the host.",
            recommendation: "Confirm the intended owner/service account and deployment model, then remove write permission for other users unless it is explicitly required and separately isolated.",
            evidence: permissionEvidence(index, ownerEvidencePresent),
          });
        } else if ((group & 0b010) !== 0) {
          candidates.push({
            id: stableId(["web-root-permissions", "group-writable", String(index)]),
            severity: "low",
            category: "permissions",
            title: "Candidate web root is group-writable",
            summary: "Collected permission evidence indicates that a candidate web root is writable by its owning group. This can be intentional for deployment workflows, so it is reported as a review candidate rather than an unsafe-state assertion.",
            recommendation: "Verify that group membership is intentionally limited to the deployment/runtime principals that require write access and narrow the mode if broader write access is unnecessary.",
            evidence: permissionEvidence(index, ownerEvidencePresent),
          });
        }
      }
    }

    const normalizedOwner = root.owner?.trim().toLowerCase();
    const applicationRoot = root.frameworkHints?.some((hint) => /laravel|node|next|wordpress/i.test(hint)) === true;
    if ((normalizedOwner === "root" || normalizedOwner === "0") && applicationRoot) {
      candidates.push({
        id: stableId(["web-root-permissions", "privileged-owner", String(index)]),
        severity: "low",
        category: "permissions",
        title: "Application web root uses a privileged owner",
        summary: "Collected ownership and framework evidence indicate that a candidate application web root is owned by a privileged account. This can be intentional for immutable deployments, so it is reported as a review candidate rather than an unsafe-state assertion.",
        recommendation: "Confirm the deployment/runtime ownership model and prefer a dedicated application owner when privileged ownership is not required.",
        evidence: privilegedOwnerEvidence(index),
      });
    }
  });

  const sorted = candidates.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );

  if (sorted.length <= MAX_FINDINGS) return sorted;

  const bounded = sorted.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["web-root-permissions", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Web-root permission findings were truncated",
    summary: "The deterministic web-root permission stage reached its finding limit, so additional candidate roots may require review outside the emitted evidence.",
    recommendation: "Review the bounded findings first, then split or narrow the read-only snapshot before drawing a repository-wide permission conclusion.",
    evidence: [{ source: "web.roots", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
