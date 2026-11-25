import assert from "node:assert/strict";
import test from "node:test";

import { PR_GATE_NOT_RUN, combineFindings, parsePrGateResult, parseScanResponse, prGateFindings, renderScanReportMarkdown, type RepoSecurityScan } from "./scan-report";

const SCAN: RepoSecurityScan = {
  schema: "solvelang.repo-security-scan.v1",
  repo: "acme/widgets",
  url: "https://github.com/acme/widgets",
  defaultBranch: "main",
  readAt: "2026-11-24T19:00:00.000Z",
  cached: true,
  routes: [{ route: "GET /repos/acme/widgets/git/trees/main", status: "failed", detail: "answered 403" }],
  findings: [
    { id: "security-policy", label: "failed", text: "The security-policy check could not be completed.", provenance: "Tree read failed." },
  ],
  grading: { verified: 0, failed: 1, unverified: 0, falseVerifiedLabel: false, plainStatement: "Nothing here is a risk score." },
};

test("QA: a failed route's findings stay failed through the merge and the markdown says the read was cached", () => {
  const { grading } = combineFindings(SCAN, PR_GATE_NOT_RUN);
  assert.equal(grading.verified, 0);
  assert.equal(grading.failed, 1);
  assert.equal(grading.unverified, 1);
  const markdown = renderScanReportMarkdown(SCAN, PR_GATE_NOT_RUN);
  assert.match(markdown, /served from the scan cache/);
  assert.match(markdown, /Nothing here is a risk score\./);
});

test("QA: a finding without provenance is refused outright", () => {
  assert.throws(() => parseScanResponse({ ...SCAN, findings: [{ id: "x", label: "verified", text: "t" }] }));
});

test("QA: an overridden PR Gate verdict is reported as overridden, not as a pass", () => {
  const result = JSON.stringify({
    schema: "solvelang.pr-gate.result.v1",
    mode: "report-only",
    repo: "acme/widgets",
    revision: "abc123",
    graph: { integrityVerified: true },
    impact: { headline: "h" },
    policy: { source: "s", evaluation: { passed: true, verdicts: [{ rule: "blast-radius-ceiling", status: "overridden", detail: "Owner label applied." }] } },
  });
  const findings = prGateFindings(parsePrGateResult(result));
  const verdict = findings.find((item) => item.id === "pr-gate-blast-radius-ceiling");
  assert.ok(verdict);
  assert.equal(verdict.label, "verified");
  assert.match(verdict.text, /overridden by label/);
});

test("QA: a PR Gate result for a different schema version is a failed route", () => {
  const route = parsePrGateResult(JSON.stringify({ schema: "solvelang.pr-gate.result.v2" }));
  assert.equal(route.status, "failed");
});
