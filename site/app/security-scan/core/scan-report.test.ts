import assert from "node:assert/strict";
import test from "node:test";

import { PR_GATE_NOT_RUN, combineFindings, parsePrGateResult, parseScanResponse, renderScanReportMarkdown, type RepoSecurityScan } from "./scan-report";

const SCAN: RepoSecurityScan = {
  schema: "solvelang.repo-security-scan.v1",
  repo: "acme/widgets",
  url: "https://github.com/acme/widgets",
  defaultBranch: "main",
  readAt: "2026-11-24T19:00:00.000Z",
  cached: false,
  routes: [{ route: "GET /repos/acme/widgets", status: "ok" }],
  findings: [
    { id: "security-policy", label: "verified", text: "A security policy is published at SECURITY.md.", provenance: "Repository file tree of main." },
    { id: "branch-protection", label: "unverified", text: "Whether main is protected could not be checked.", provenance: "Protection endpoint answered 404." },
  ],
  grading: { verified: 1, failed: 0, unverified: 1, falseVerifiedLabel: false, plainStatement: "Every finding is labeled." },
};

const PR_GATE_RESULT = JSON.stringify({
  schema: "solvelang.pr-gate.result.v1",
  mode: "report-only",
  repo: "acme/widgets",
  revision: "abc123",
  graph: { integrityVerified: true, nodes: 10, edges: 12 },
  impact: { headline: "2 files impact 5 nodes", rootCount: 2, impactedNodes: 5 },
  policy: {
    source: "pr-gate.policy.json",
    evaluation: {
      passed: false,
      verdicts: [
        { rule: "protected-paths", status: "pass", detail: "No protected path was changed." },
        { rule: "blast-radius-ceiling", status: "fail", detail: "Impact of 5 nodes exceeds the ceiling of 4." },
        { rule: "affected-validations", status: "skipped", detail: "Rule not enabled." },
      ],
    },
  },
});

test("parseScanResponse accepts the API shape and refuses anything else", () => {
  assert.equal(parseScanResponse(SCAN).repo, "acme/widgets");
  assert.throws(() => parseScanResponse({ schema: "other" }));
  assert.throws(() => parseScanResponse({ ...SCAN, findings: [{ id: "x", label: "certain", text: "t", provenance: "p" }] }));
});

test("without a PR Gate result the route is recorded unverified, never dropped", () => {
  const { findings, grading } = combineFindings(SCAN, PR_GATE_NOT_RUN);
  const gate = findings.find((item) => item.id === "pr-gate");
  assert.ok(gate);
  assert.equal(gate.label, "unverified");
  assert.match(gate.text, /was not run/);
  assert.equal(grading.verified, 1);
  assert.equal(grading.unverified, 2);
  assert.equal(grading.falseVerifiedLabel, false);
});

test("a pasted PR Gate result merges its verdicts with honest labels", () => {
  const route = parsePrGateResult(PR_GATE_RESULT);
  assert.equal(route.status, "ran");
  const { findings, grading } = combineFindings(SCAN, route);
  const byId = Object.fromEntries(findings.map((item) => [item.id, item]));
  assert.equal(byId["pr-gate-protected-paths"].label, "verified");
  assert.equal(byId["pr-gate-blast-radius-ceiling"].label, "verified");
  assert.match(byId["pr-gate-blast-radius-ceiling"].text, /FAILED/);
  assert.equal(byId["pr-gate-affected-validations"].label, "unverified");
  assert.equal(byId["pr-gate-impact"].label, "verified");
  assert.equal(grading.verified, 4);
});

test("an unverified-integrity PR Gate result is labeled failed, not trusted", () => {
  const tampered = JSON.stringify({ ...JSON.parse(PR_GATE_RESULT), graph: { integrityVerified: false } });
  const route = parsePrGateResult(tampered);
  const { findings } = combineFindings(SCAN, route);
  const gate = findings.filter((item) => item.id.startsWith("pr-gate"));
  assert.equal(gate.length, 1);
  assert.equal(gate[0].label, "failed");
  assert.match(gate[0].text, /NOT verified/);
});

test("garbage pasted as a PR Gate result is a failed route with the reason", () => {
  const route = parsePrGateResult("{not json");
  assert.equal(route.status, "failed");
  const { findings } = combineFindings(SCAN, route);
  assert.equal(findings.find((item) => item.id === "pr-gate")?.label, "failed");
});

test("the markdown report carries labels, provenance, and routes", () => {
  const markdown = renderScanReportMarkdown(SCAN, parsePrGateResult(PR_GATE_RESULT));
  assert.match(markdown, /# Repo Security Scan - acme\/widgets/);
  assert.match(markdown, /\[verified\] A security policy is published/);
  assert.match(markdown, /Provenance: Repository file tree of main\./);
  assert.match(markdown, /PR Gate route - ran/);
  assert.ok(!/risk score: \d/i.test(markdown));
});
