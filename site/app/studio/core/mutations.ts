import { parseWorkflowDocument } from "./schema";
import type { WorkflowDocument, WorkflowNode, WorkflowScenario } from "./types";

export type WorkflowMutationResult =
  | { ok: true; document: WorkflowDocument }
  | { ok: false; document: WorkflowDocument; error: string };

export function applyWorkflowMutation(
  current: WorkflowDocument,
  mutation: (draft: WorkflowDocument) => WorkflowDocument,
  updatedAt = new Date().toISOString(),
): WorkflowMutationResult {
  let mutated: WorkflowDocument;
  try { mutated = mutation(structuredClone(current)); }
  catch (error) { return { ok: false, document: current, error: error instanceof Error ? error.message : "Workflow mutation rejected." }; }
  const proposed = { ...mutated, updatedAt };
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

export function updateNodeAndReferences(current: WorkflowDocument, updatedNode: WorkflowNode): WorkflowMutationResult {
  return applyWorkflowMutation(current, (draft) => {
    const previousNode = draft.nodes.find((node) => node.id === updatedNode.id);
    if (!previousNode) throw new Error("Node no longer exists.");
    const proposedOutputs = updatedNode.outputs.map((output) => output.trim());
    if (proposedOutputs.some((output) => !output)) throw new Error("Output names cannot be empty.");
    if (new Set(proposedOutputs).size !== proposedOutputs.length) throw new Error("Output names must be unique.");
    const renamedOutputs = proposedOutputs.filter((output, index) => output !== previousNode.outputs[index]);
    const outputOwnedByAnotherNode = draft.nodes.some((node) => node.id !== updatedNode.id && renamedOutputs.some((output) => node.outputs.includes(output)));
    if (outputOwnedByAnotherNode) throw new Error("Output name already exists on another node.");
    const referencedOutputs = new Set(draft.scenarios.flatMap((scenario) => scenario.expectedOutputs));
    const removedOutputs = previousNode.outputs.filter((output) => !proposedOutputs.includes(output));
    for (const output of removedOutputs) {
      if (previousNode.outputs.length !== proposedOutputs.length && referencedOutputs.has(output)) {
        throw new Error(`Cannot remove referenced output ${output}. Update scenario expectations first.`);
      }
    }
    const replacementByOutput = previousNode.outputs.length === proposedOutputs.length
      ? new Map(previousNode.outputs.map((output, index) => [output, proposedOutputs[index]]))
      : new Map<string, string>();
    const normalizedNode = { ...structuredClone(updatedNode), outputs: proposedOutputs };
    draft.nodes = draft.nodes.map((node) => node.id === updatedNode.id ? normalizedNode : node);
    draft.scenarios = draft.scenarios.map((scenario) => ({
      ...scenario,
      expectedOutputs: scenario.expectedOutputs.map((output) => replacementByOutput.get(output) ?? output),
    })).map((scenario) => ({ ...scenario, expectedOutputs: [...new Set(scenario.expectedOutputs)] }));
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
