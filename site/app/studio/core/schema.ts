import { z } from "zod";
import { NODE_TYPES, type ScenarioRun, type VersionSnapshot, type WorkflowDocument } from "./types";

const MAX_TEXT = 100_000;
const text = z.string().max(MAX_TEXT);
const safeRecordKey = (key: string) => !["__proto__", "prototype", "constructor"].includes(key);
const stringMap = z.record(z.string(), text).superRefine((value, context) => {
  for (const key of Object.keys(value)) if (!safeRecordKey(key)) context.addIssue({ code: "custom", path: [key], message: "Unsafe object key is not allowed." });
});
const evidenceSchema = z.object({ label: text, value: text }).strict();

const nodeSchema = z.object({
  id: z.string().min(1).max(500),
  type: z.enum(NODE_TYPES),
  title: z.string().min(1).max(MAX_TEXT),
  description: text,
  owner: text,
  system: text,
  inputs: z.array(text).max(10_000),
  outputs: z.array(text).max(10_000),
  policyRefs: z.array(z.string().min(1).max(500)).max(10_000),
  slaMinutes: z.number().int().nonnegative().nullable(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  humanRequired: z.boolean(),
  evidence: z.array(evidenceSchema),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  metadata: stringMap,
}).strict();

const edgeSchema = z.object({
  id: z.string().min(1).max(500), source: z.string().min(1).max(500), target: z.string().min(1).max(500), condition: text,
  priority: z.number().int(), label: text, fallback: z.boolean(), metadata: stringMap,
}).strict();

const scenarioSchema = z.object({
  id: z.string().min(1).max(500), name: z.string().min(1).max(MAX_TEXT), description: text, startingTrigger: z.string().max(500),
  inputVariables: stringMap, decisionOutcomes: stringMap, expectedTerminalState: z.string(),
  expectedHumanReviewPoints: z.array(z.string().max(500)).max(10_000), expectedOutputs: z.array(text).max(10_000),
}).strict();

const policySchema = z.object({
  id: z.string().min(1).max(500), title: z.string().min(1).max(MAX_TEXT), description: text, owner: text,
  scope: text, evidence: z.array(evidenceSchema).max(10_000), metadata: stringMap,
}).strict();

export const WorkflowDocumentSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1).max(500), name: z.string().min(1).max(MAX_TEXT), description: text,
  version: z.string().min(1).max(100), createdAt: z.string().max(100), updatedAt: z.string().max(100), nodes: z.array(nodeSchema).max(1_000),
  edges: z.array(edgeSchema).max(5_000), scenarios: z.array(scenarioSchema).max(500), policies: z.array(policySchema).max(1_000),
  analytics: z.object({ tags: z.array(text).max(1_000), lastAnalyzedAt: z.string().max(100).nullable(), analysisRuns: z.number().int().nonnegative() }).strict(),
  suppressedRuleIds: z.array(z.string().max(20)).max(100),
}).strict().superRefine((document, context) => {
  const unique = (items: Array<{ id: string }>, path: "nodes" | "edges" | "scenarios" | "policies") => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({ code: "custom", path: [path, index, "id"], message: `Duplicate ${path.slice(0, -1)} ID ${item.id}.` });
      seen.add(item.id);
    });
  };
  unique(document.nodes, "nodes"); unique(document.edges, "edges"); unique(document.scenarios, "scenarios"); unique(document.policies, "policies");
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const policies = new Set(document.policies.map((policy) => policy.id));
  const outputs = new Set(document.nodes.flatMap((node) => node.outputs));
  document.edges.forEach((edge, index) => {
    if (!nodes.has(edge.source)) context.addIssue({ code: "custom", path: ["edges", index, "source"], message: `Unknown source node ${edge.source}.` });
    if (!nodes.has(edge.target)) context.addIssue({ code: "custom", path: ["edges", index, "target"], message: `Unknown target node ${edge.target}.` });
  });
  document.nodes.forEach((node, index) => node.policyRefs.forEach((policyId, policyIndex) => {
    if (!policies.has(policyId)) context.addIssue({ code: "custom", path: ["nodes", index, "policyRefs", policyIndex], message: `Unknown policy ${policyId}.` });
  }));
  document.scenarios.forEach((scenario, index) => {
    const trigger = nodes.get(scenario.startingTrigger);
    if (!trigger || trigger.type !== "trigger") context.addIssue({ code: "custom", path: ["scenarios", index, "startingTrigger"], message: `Starting trigger ${scenario.startingTrigger || "(missing)"} must reference a trigger node.` });
    if (scenario.expectedTerminalState && nodes.get(scenario.expectedTerminalState)?.type !== "terminal") context.addIssue({ code: "custom", path: ["scenarios", index, "expectedTerminalState"], message: `Expected terminal ${scenario.expectedTerminalState} must reference a terminal node.` });
    Object.keys(scenario.decisionOutcomes).forEach((nodeId) => {
      if (nodes.get(nodeId)?.type !== "decision") context.addIssue({ code: "custom", path: ["scenarios", index, "decisionOutcomes", nodeId], message: `Decision outcome key ${nodeId} must reference a decision node.` });
    });
    scenario.expectedHumanReviewPoints.forEach((nodeId, reviewIndex) => {
      const node = nodes.get(nodeId);
      if (!node || !(node.humanRequired || node.type === "human_review" || node.type === "approval")) context.addIssue({ code: "custom", path: ["scenarios", index, "expectedHumanReviewPoints", reviewIndex], message: `Expected review ${nodeId} must reference a human-review node.` });
    });
    scenario.expectedOutputs.forEach((output, outputIndex) => {
      if (!outputs.has(output)) context.addIssue({ code: "custom", path: ["scenarios", index, "expectedOutputs", outputIndex], message: `Expected output ${output} is not produced by any node.` });
    });
  });
});

const traceEventSchema = z.object({
  sequence: z.number().int().positive(), nodeId: z.string(), nodeType: z.enum(NODE_TYPES), action: z.string(), inputSummary: z.string(),
  outputSummary: z.string(), decision: z.string(), policyResult: z.string(), humanReviewState: z.enum(["not-required", "paused"]),
  warnings: z.array(z.string()), durationEstimate: z.number().nonnegative(),
}).strict();

export const ScenarioRunSchema: z.ZodType<ScenarioRun> = z.object({
  id: z.string(), scenarioId: z.string(), scenarioName: z.string(), passed: z.boolean(), path: z.array(z.string()), branchesTaken: z.array(z.string()),
  branchesSkipped: z.array(z.string()), unresolvedDecisions: z.array(z.string()), humanReviewPauses: z.array(z.string()),
  policyChecks: z.array(z.object({ nodeId: z.string(), policyId: z.string(), result: z.enum(["passed", "missing"]) }).strict()),
  terminalResult: z.string().nullable(), elapsedSlaMinutes: z.number().nonnegative(), outputs: z.array(z.string()), warnings: z.array(z.string()),
  failures: z.array(z.string()), trace: z.array(traceEventSchema),
}).strict();

export const VersionSnapshotSchema: z.ZodType<VersionSnapshot> = z.object({
  id: z.string(), label: z.string(), timestamp: z.string(), summary: z.string(), nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(), scoreSnapshot: z.number().min(0).max(100), fingerprint: z.string(), document: WorkflowDocumentSchema,
}).strict();

function containsUnsafeObjectKey(input: unknown, seen = new Set<object>()): boolean {
  if (!input || typeof input !== "object" || seen.has(input)) return false;
  seen.add(input);
  if (Object.keys(input).some((key) => !safeRecordKey(key))) return true;
  return Object.values(input).some((value) => containsUnsafeObjectKey(value, seen));
}

export function parseWorkflowDocument(input: unknown): { ok: true; document: WorkflowDocument } | { ok: false; error: string } {
  if (containsUnsafeObjectKey(input)) return { ok: false, error: "document: Unsafe object key is not allowed." };
  const result = WorkflowDocumentSchema.safeParse(input);
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    error: result.error.issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; "),
  };
}
