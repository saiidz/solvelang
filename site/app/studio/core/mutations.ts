import { parseWorkflowDocument } from "./schema";
import type { WorkflowDocument, WorkflowScenario } from "./types";

export type WorkflowMutationResult =
  | { ok: true; document: WorkflowDocument }
  | { ok: false; document: WorkflowDocument; error: string };

export function applyWorkflowMutation(
  current: WorkflowDocument,
  mutation: (draft: WorkflowDocument) => WorkflowDocument,
  updatedAt = new Date().toISOString(),
): WorkflowMutationResult {
  const proposed = { ...mutation(structuredClone(current)), updatedAt };
  const parsed = parseWorkflowDocument(proposed);
  if (!parsed.ok) return { ok: false, document: current, error: parsed.error };
  return { ok: true, document: parsed.document };
}

export function addScenarioToWorkflow(current: WorkflowDocument, id: string): WorkflowMutationResult {
  const trigger = current.nodes.find((node) => node.type === "trigger");
  if (!trigger) return { ok: false, document: current, error: "Add a trigger node first." };
  const scenario: WorkflowScenario = {
    id,
    name: "New scenario",
    description: "",
    startingTrigger: trigger.id,
    inputVariables: {},
    decisionOutcomes: {},
    expectedTerminalState: "",
    expectedHumanReviewPoints: [],
    expectedOutputs: [],
  };
  return applyWorkflowMutation(current, (draft) => {
    draft.scenarios.push(scenario);
    return draft;
  });
}

export function parseFiniteInteger(
  rawValue: string,
  options: { nullable?: boolean; minimum?: number } = {},
): { ok: true; value: number | null } | { ok: false; error: string } {
  const value = rawValue.trim();
  if (!value) {
    return options.nullable
      ? { ok: true, value: null }
      : { ok: false, error: "Enter a finite whole number." };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return { ok: false, error: "Enter a finite whole number." };
  if (options.minimum !== undefined && parsed < options.minimum) return { ok: false, error: `Enter a whole number of at least ${options.minimum}.` };
  return { ok: true, value: parsed };
}
