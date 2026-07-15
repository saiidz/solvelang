import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWorkflow } from "./analysis";
import { calculateWorkflowAnalytics } from "./analytics";
import { exportAnalyticsCsv, exportMarkdownReport, exportPrintableHtml, generateSolveLangDraft, serializeWorkflow } from "./exports";
import { simulateScenario } from "./simulation";
import { parseWorkflowDocument } from "./schema";
import { validSupportTriageFixture } from "./fixtures";

test("canonical workflow export round trips through schema validation", () => {
  const workflow = validSupportTriageFixture();
  const parsed = parseWorkflowDocument(JSON.parse(serializeWorkflow(workflow)));
  assert.equal(parsed.ok, true);
});

test("evidence exports contain real findings, analytics, and print content", () => {
  const workflow = validSupportTriageFixture();
  const analysis = analyzeWorkflow(workflow);
  const runs = workflow.scenarios.map((scenario) => simulateScenario(workflow, scenario));
  const analytics = calculateWorkflowAnalytics(workflow, runs);
  assert.match(exportAnalyticsCsv(analytics), /metric,value/);
  assert.match(exportMarkdownReport(workflow, analysis, analytics), /Workflow X-Ray/);
  assert.match(exportPrintableHtml(workflow, analysis, analytics), /<!doctype html>/i);
});

test("generated SolveLang draft is clearly labeled and preserves review and policy intent", () => {
  const draft = generateSolveLangDraft(validSupportTriageFixture());
  assert.match(draft, /GENERATED DRAFT/);
  assert.match(draft, /human review/i);
  assert.match(draft, /policy/i);
  assert.match(draft, /Studio-only/i);
});
