// SolveLang Repo Security Scan - pure report builder for the page.
//
// The scan itself runs on SolveLang's API (POST
// /public/repo-security-scan): it reads a public repository's
// facts from the GitHub API and returns findings already labeled
// verified / failed / unverified, each with provenance. This
// module validates that response, optionally merges the PR Gate
// route - the change-level half of the scan, from a PR Gate
// result (schema solvelang.pr-gate.result.v1) the visitor pastes,
// produced by running the PR Gate kit in report-only mode - and
// renders the combined report as markdown.
//
// Provenance discipline (absolute), shared with the Change Impact
// Receipts: every finding is labeled; a route that could not run
// is labeled failed, never silently dropped; a route that was not
// run is recorded as unverified with the reason; no risk scores
// are produced anywhere; nothing is fabricated.

export type ScanLabel = "verified" | "failed" | "unverified";

export type ScanFinding = {
  id: string;
  label: ScanLabel;
  text: string;
  provenance: string;
};

export type ScanRoute = {
  route: string;
  status: "ok" | "failed";
  detail?: string;
};

export type RepoSecurityScan = {
  schema: "solvelang.repo-security-scan.v1";
  repo: string;
  url: string;
  defaultBranch: string | null;
  readAt: string;
  cached: boolean;
  routes: ScanRoute[];
  findings: ScanFinding[];
  grading: {
    verified: number;
    failed: number;
    unverified: number;
    falseVerifiedLabel: false;
    plainStatement: string;
  };
};

export type PrGateRoute =
  | {
      status: "ran";
      mode: string;
      repo: string;
      revision: string;
      integrityVerified: boolean;
      policyPassed: boolean;
      verdicts: { rule: string; status: string; detail: string }[];
      impactHeadline: string | null;
      provenance: string;
    }
  | { status: "failed"; error: string; provenance: string }
  | { status: "not-run"; reason: string; provenance: string };

export const PR_GATE_NOT_RUN: PrGateRoute = {
  status: "not-run",
  reason: "No PR Gate result was supplied with this scan.",
  provenance: "Scan page: the PR Gate route is optional and runs only on a result the visitor supplies.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is ScanLabel {
  return value === "verified" || value === "failed" || value === "unverified";
}

export function parseScanResponse(value: unknown): RepoSecurityScan {
  if (!isRecord(value) || value.schema !== "solvelang.repo-security-scan.v1") {
    throw new Error("The scan response did not carry the expected schema.");
  }
  if (typeof value.repo !== "string" || typeof value.readAt !== "string" || !Array.isArray(value.findings)) {
    throw new Error("The scan response was missing its repository, read time, or findings.");
  }
  for (const item of value.findings) {
    if (!isRecord(item) || typeof item.id !== "string" || !isLabel(item.label) || typeof item.text !== "string" || typeof item.provenance !== "string") {
      throw new Error("The scan response carried a finding without a label, text, or provenance.");
    }
  }
  return value as RepoSecurityScan;
}

export function parsePrGateResult(text: string): PrGateRoute {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "failed", error: "The pasted text is not valid JSON.", provenance: "PR Gate result as pasted by the visitor." };
  }
  if (!isRecord(parsed) || parsed.schema !== "solvelang.pr-gate.result.v1") {
    return { status: "failed", error: "The pasted JSON is not a PR Gate result (schema solvelang.pr-gate.result.v1).", provenance: "PR Gate result as pasted by the visitor." };
  }
  const policy = isRecord(parsed.policy) ? parsed.policy : null;
  const evaluation = policy && isRecord(policy.evaluation) ? policy.evaluation : null;
  if (!evaluation || !Array.isArray(evaluation.verdicts)) {
    return { status: "failed", error: "The PR Gate result carried no policy evaluation verdicts.", provenance: "PR Gate result as pasted by the visitor." };
  }
  const graph = isRecord(parsed.graph) ? parsed.graph : null;
  const impact = isRecord(parsed.impact) ? parsed.impact : null;
  return {
    status: "ran",
    mode: typeof parsed.mode === "string" ? parsed.mode : "unknown",
    repo: typeof parsed.repo === "string" ? parsed.repo : "unknown",
    revision: typeof parsed.revision === "string" ? parsed.revision : "unknown",
    integrityVerified: graph?.integrityVerified === true,
    policyPassed: evaluation.passed === true,
    verdicts: evaluation.verdicts
      .filter(isRecord)
      .map((verdict) => ({
        rule: typeof verdict.rule === "string" ? verdict.rule : "unknown",
        status: typeof verdict.status === "string" ? verdict.status : "unknown",
        detail: typeof verdict.detail === "string" ? verdict.detail : "",
      })),
    impactHeadline: impact && typeof impact.headline === "string" ? impact.headline : null,
    provenance: "PR Gate result as pasted by the visitor; the kit produced it locally or in the visitor's CI.",
  };
}

export function prGateFindings(route: PrGateRoute): ScanFinding[] {
  if (route.status === "not-run") {
    return [{
      id: "pr-gate",
      label: "unverified",
      text: "The change-level PR Gate route was not run: no PR Gate result was supplied. The scan above covers repository posture from public API facts; the kit's policy verdicts for a specific change need a PR Gate run (the GitHub Action or CLI) in report-only mode, whose result.json can be pasted here.",
      provenance: route.provenance,
    }];
  }
  if (route.status === "failed") {
    return [{
      id: "pr-gate",
      label: "failed",
      text: `The PR Gate route could not be used: ${route.error}`,
      provenance: route.provenance,
    }];
  }
  const provenance = `PR Gate result for ${route.repo}@${route.revision} (schema solvelang.pr-gate.result.v1, mode ${route.mode}), supplied by the visitor.`;
  if (!route.integrityVerified) {
    return [{
      id: "pr-gate",
      label: "failed",
      text: "The supplied PR Gate result reports that its Solve Graph integrity was NOT verified, so its verdicts are not relied on in this report.",
      provenance,
    }];
  }
  const findings: ScanFinding[] = route.verdicts.map((verdict) => {
    if (verdict.status === "pass") {
      return { id: `pr-gate-${verdict.rule}`, label: "verified" as ScanLabel, text: `PR Gate policy rule "${verdict.rule}" passed: ${verdict.detail}`, provenance };
    }
    if (verdict.status === "fail") {
      return { id: `pr-gate-${verdict.rule}`, label: "verified" as ScanLabel, text: `PR Gate policy rule "${verdict.rule}" FAILED: ${verdict.detail}`, provenance };
    }
    if (verdict.status === "overridden") {
      return { id: `pr-gate-${verdict.rule}`, label: "verified" as ScanLabel, text: `PR Gate policy rule "${verdict.rule}" failed but was overridden by label: ${verdict.detail}`, provenance };
    }
    return { id: `pr-gate-${verdict.rule}`, label: "unverified" as ScanLabel, text: `PR Gate policy rule "${verdict.rule}" was ${verdict.status}: ${verdict.detail}`, provenance };
  });
  if (route.impactHeadline) {
    findings.push({
      id: "pr-gate-impact",
      label: "verified",
      text: `Change impact per the kit: ${route.impactHeadline}`,
      provenance,
    });
  }
  return findings;
}

export function combineFindings(scan: RepoSecurityScan, route: PrGateRoute): { findings: ScanFinding[]; grading: RepoSecurityScan["grading"] } {
  const findings = [...scan.findings, ...prGateFindings(route)];
  const counts = { verified: 0, failed: 0, unverified: 0 };
  for (const item of findings) counts[item.label] += 1;
  return {
    findings,
    grading: {
      ...counts,
      falseVerifiedLabel: false,
      plainStatement: scan.grading.plainStatement,
    },
  };
}

export function renderScanReportMarkdown(scan: RepoSecurityScan, route: PrGateRoute): string {
  const { findings, grading } = combineFindings(scan, route);
  const lines: string[] = [];
  lines.push(`# Repo Security Scan - ${scan.repo}`);
  lines.push("");
  lines.push(`- Repository: ${scan.url}`);
  lines.push(`- Default branch: ${scan.defaultBranch ?? "unknown"}`);
  lines.push(`- Read at: ${scan.readAt}${scan.cached ? " (served from the scan cache; the read time is the original read)" : ""}`);
  lines.push(`- Findings: ${grading.verified} verified, ${grading.failed} failed, ${grading.unverified} unverified`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  for (const item of findings) {
    lines.push(`- [${item.label}] ${item.text}`);
    lines.push(`  Provenance: ${item.provenance}`);
  }
  lines.push("");
  lines.push("## Routes");
  lines.push("");
  for (const item of scan.routes) {
    lines.push(`- ${item.route} - ${item.status}${item.detail ? ` (${item.detail})` : ""}`);
  }
  lines.push(`- PR Gate route - ${route.status}${route.status === "not-run" ? ` (${route.reason})` : ""}`);
  lines.push("");
  lines.push(grading.plainStatement);
  lines.push("");
  return lines.join("\n");
}
