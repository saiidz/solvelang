import { z } from "zod";
import { NODE_TYPES, type WorkflowDocument } from "./types";

const stringMap = z.record(z.string(), z.string());
const evidenceSchema = z.object({ label: z.string(), value: z.string() });

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  title: z.string().min(1),
  description: z.string(),
  owner: z.string(),
  system: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  policyRefs: z.array(z.string()),
  slaMinutes: z.number().int().nonnegative().nullable(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  humanRequired: z.boolean(),
  evidence: z.array(evidenceSchema),
  position: z.object({ x: z.number(), y: z.number() }),
  metadata: stringMap,
});

const edgeSchema = z.object({
  id: z.string().min(1), source: z.string(), target: z.string(), condition: z.string(),
  priority: z.number().int(), label: z.string(), fallback: z.boolean(), metadata: stringMap,
});

const scenarioSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string(), startingTrigger: z.string(),
  inputVariables: stringMap, decisionOutcomes: stringMap, expectedTerminalState: z.string(),
  expectedHumanReviewPoints: z.array(z.string()), expectedOutputs: z.array(z.string()),
});

const policySchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string(), owner: z.string(),
  scope: z.string(), evidence: z.array(evidenceSchema), metadata: stringMap,
});

export const WorkflowDocumentSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), description: z.string(),
  version: z.string().min(1), createdAt: z.string(), updatedAt: z.string(), nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema), scenarios: z.array(scenarioSchema), policies: z.array(policySchema),
  analytics: z.object({ tags: z.array(z.string()), lastAnalyzedAt: z.string().nullable(), analysisRuns: z.number().int().nonnegative() }),
  suppressedRuleIds: z.array(z.string()),
});

export function parseWorkflowDocument(input: unknown): { ok: true; document: WorkflowDocument } | { ok: false; error: string } {
  const result = WorkflowDocumentSchema.safeParse(input);
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    error: result.error.issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; "),
  };
}
