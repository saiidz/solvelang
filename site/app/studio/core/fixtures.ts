import { createSupportTriageDocument, makeNode } from "./templates";
import type { WorkflowDocument } from "./types";

export function validSupportTriageFixture(): WorkflowDocument {
  return structuredClone(createSupportTriageDocument());
}

function addNode(document: WorkflowDocument, node = makeNode(`fixture-${document.nodes.length}`, "action", "Fixture action", 300, 520)) {
  document.nodes.push(node);
  return node;
}

export function fixtureForRule(ruleId: string): WorkflowDocument {
  const document = validSupportTriageFixture();
  const decision = document.nodes.find((node) => node.type === "decision")!;
  const action = document.nodes.find((node) => node.type === "action")!;

  switch (ruleId) {
    case "SL001": document.nodes = document.nodes.filter((node) => node.type !== "trigger"); break;
    case "SL002": addNode(document, makeNode("trigger-secondary", "trigger", "Second trigger", 40, 400)); break;
    case "SL003": document.nodes = document.nodes.filter((node) => node.type !== "terminal"); break;
    case "SL004": addNode(document, makeNode("unreachable-a", "action", "Unreachable action", 50, 600)); document.edges.push({ id: "unreachable-edge", source: "unreachable-a", target: "unreachable-a", condition: "", priority: 1, label: "loop", fallback: false, metadata: {} }); break;
    case "SL005": document.edges = document.edges.filter((edge) => edge.source !== action.id); break;
    case "SL006": document.edges.filter((edge) => edge.source === decision.id).forEach((edge) => { edge.fallback = false; }); break;
    case "SL007": { const edges = document.edges.filter((edge) => edge.source === decision.id); edges[1].condition = edges[0].condition; break; }
    case "SL008": { const edge = document.edges.find((item) => item.source === decision.id)!; edge.condition = ""; edge.label = ""; edge.fallback = false; break; }
    case "SL009": document.edges = document.edges.filter((edge) => edge.source !== action.id); document.edges.push({ id: "cycle", source: action.id, target: action.id, condition: "", priority: 1, label: "repeat", fallback: false, metadata: {} }); break;
    case "SL010": action.humanRequired = true; break;
    case "SL011": addNode(document, makeNode("approval-empty", "approval", "Approve", 500, 600, { metadata: {} })); break;
    case "SL012": action.owner = ""; break;
    case "SL013": addNode(document, makeNode("system-empty", "system", "System step", 500, 600, { system: "" })); break;
    case "SL014": addNode(document, makeNode("input-empty", "data_input", "Input", 500, 600, { metadata: {} })); break;
    case "SL015": addNode(document, makeNode("output-empty", "data_output", "Output", 500, 600, { metadata: {} })); break;
    case "SL016": action.metadata = {}; break;
    case "SL017": action.slaMinutes = null; break;
    case "SL018": action.riskLevel = "high"; action.humanRequired = false; break;
    case "SL019": action.metadata.sensitiveData = "true"; action.policyRefs = []; break;
    case "SL020": { const notification = document.nodes.find((node) => node.type === "notification")!; notification.metadata.recipient = ""; break; }
    case "SL021": { const exception = document.nodes.find((node) => node.type === "exception")!; exception.metadata = {}; document.edges = document.edges.filter((edge) => edge.source !== exception.id); break; }
    case "SL022": document.nodes.push(structuredClone(document.nodes[0])); break;
    case "SL023": document.edges.push({ id: "invalid-edge", source: "missing-source", target: "missing-target", condition: "", priority: 1, label: "invalid", fallback: false, metadata: {} }); break;
    case "SL024": addNode(document, makeNode("orphan", "policy", "Orphan node", 500, 600)); break;
    case "SL025": document.policies.push({ id: "policy-unused", title: "Unused policy", description: "", owner: "operations", scope: "all", evidence: [], metadata: {} }); break;
    default: throw new Error(`Unknown fixture rule ${ruleId}`);
  }
  return document;
}
