import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowDocumentSchema, parseWorkflowDocument } from "./schema";
import { workflowTemplates } from "./templates";

test("all included templates satisfy the canonical workflow schema", () => {
  assert.deepEqual(
    workflowTemplates.map((template) => template.key),
    ["support-triage", "lead-qualification", "customer-intake", "invoice-approval", "incident-escalation"],
  );
  for (const template of workflowTemplates) {
    assert.equal(WorkflowDocumentSchema.safeParse(template.document).success, true, template.key);
  }
  assert.equal(new Set(workflowTemplates.map((template) => template.document.nodes.map((node) => node.title).join("|"))).size, workflowTemplates.length, "templates must model distinct domain workflows");
});

test("workflow parsing rejects unsupported node types", () => {
  const source = structuredClone(workflowTemplates[0].document) as unknown as Record<string, unknown>;
  const nodes = source.nodes as Array<Record<string, unknown>>;
  nodes[0].type = "magic_agent";
  const result = parseWorkflowDocument(source);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /node type|Invalid option/i);
});

test("workflow JSON round trips without losing canonical fields", () => {
  const document = workflowTemplates[3].document;
  const result = parseWorkflowDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.document, document);
});
