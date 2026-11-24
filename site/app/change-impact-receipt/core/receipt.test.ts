import assert from "node:assert/strict";
import test from "node:test";
import { affectedAreasFor, buildChangeImpactReceipt, renderChangeImpactReceiptMarkdown } from "./receipt";
import { sampleReceiptInput } from "./sample";

test("sample receipt (real public PR) carries the sprint sections and labels", () => {
  const receipt = buildChangeImpactReceipt(sampleReceiptInput);
  assert.equal(receipt.schema, "solvelang.change-impact-receipt.v1");
  assert.equal(receipt.identity.label, "verified");
  const labels = new Set(receipt.findings.map((finding) => finding.label));
  assert.ok(labels.has("verified"));
  assert.ok(labels.has("failed"), "the failed PR Gate route must be labeled failed");
  assert.ok(labels.has("unverified"));
  for (const finding of receipt.findings) assert.ok(finding.provenance.length > 0);
  const markdown = renderChangeImpactReceiptMarkdown(receipt);
  for (const section of ["## PR identity + state as read", "## Tool route + provenance", "## What it touches", "## Receipt findings", "## Grading block"]) {
    assert.ok(markdown.includes(section), `missing section ${section}`);
  }
  assert.match(markdown, /False "verified" label\? \*\*NO\*\*/);
});

test("no risk scores anywhere in the rendered receipt", () => {
  const markdown = renderChangeImpactReceiptMarkdown(buildChangeImpactReceipt(sampleReceiptInput));
  assert.doesNotMatch(markdown.toLowerCase(), /risk score|risk rating|score: \d/);
});

test("zero check runs is a verified no-CI finding; unknown mergeable is unverified", () => {
  const receipt = buildChangeImpactReceipt({
    ...sampleReceiptInput,
    checkRuns: [],
    pr: { ...sampleReceiptInput.pr, mergeable: null, mergeableState: "unknown" },
  });
  assert.ok(receipt.findings.some((f) => f.label === "verified" && /No CI evidence/.test(f.text)));
  assert.ok(receipt.findings.some((f) => f.label === "unverified" && /Mergeable/.test(f.text)));
});

test("all-cancelled CI is verified not-green, never reported as passing", () => {
  const receipt = buildChangeImpactReceipt(sampleReceiptInput);
  assert.ok(receipt.findings.some((f) => f.label === "verified" && /CI is not green/.test(f.text)));
});

test("a zero-node PR Gate result is failed evidence, not a verified clear", () => {
  const receipt = buildChangeImpactReceipt({
    ...sampleReceiptInput,
    prGate: {
      status: "ran",
      provenance: "test provenance",
      summary: { integrityVerified: true, nodes: 10, edges: 4, impactedNodes: 0, rootCount: 2, headline: "none", policyPassed: true, policyVerdicts: [{ rule: "x", status: "skipped" }] },
    },
  });
  assert.ok(receipt.findings.some((f) => f.label === "failed" && /0 impacted nodes/.test(f.text)));
  assert.ok(receipt.findings.some((f) => f.label === "failed" && /SKIPPED/.test(f.text)));
});

test("affected areas group by the first two path segments", () => {
  const areas = affectedAreasFor(sampleReceiptInput.files);
  assert.ok(areas.some((area) => area.area === "espanso-modulo/src"));
  assert.ok(areas.some((area) => area.files.includes(".vscode/tasks.json")));
});

test("grading counts match the findings", () => {
  const receipt = buildChangeImpactReceipt(sampleReceiptInput);
  assert.equal(receipt.grading.verified, receipt.findings.filter((f) => f.label === "verified").length);
  assert.equal(receipt.grading.failed, receipt.findings.filter((f) => f.label === "failed").length);
  assert.equal(receipt.grading.unverified, receipt.findings.filter((f) => f.label === "unverified").length);
  assert.equal(receipt.grading.falseVerifiedLabel, false);
});
