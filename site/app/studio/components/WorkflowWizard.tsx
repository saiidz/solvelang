"use client";

import { useState } from "react";
import { makeNode } from "../core/templates";
import type { WorkflowDocument } from "../core/types";
import styles from "../studio.module.css";

const questions = [
  ["trigger", "What starts the workflow?", "A customer submits an intake form"],
  ["people", "Who is involved?", "operations lead, account manager"],
  ["systems", "Which tools or systems are involved?", "Gmail, HubSpot, Linear"],
  ["decisions", "What decisions occur?", "Is the request complete?"],
  ["failure", "What can go wrong?", "Required information is missing"],
  ["approval", "Where is human approval required?", "High-risk requests"],
  ["output", "What output marks success?", "A routed task with a named owner"],
] as const;

export default function WorkflowWizard({ onComplete, onCancel }: { onComplete: (workflow: WorkflowDocument) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});

  const create = () => {
    const now = new Date().toISOString();
    const owner = values.people?.split(",")[0]?.trim() || "operations";
    const system = values.systems?.split(",")[0]?.trim() || "workspace";
    const nodes = [
      makeNode("trigger-start", "trigger", values.trigger || "Workflow starts", 40, 180, { owner, system }),
      makeNode("decision-primary", "decision", values.decisions || "Review the request", 300, 180, { owner, system }),
      makeNode("action-success", "action", values.output || "Produce successful output", 570, 80, { owner, system, outputs: [values.output || "success"], metadata: { errorPath: "exception-primary" } }),
      makeNode("review-primary", "human_review", values.approval || "Human approval", 570, 280, { owner, system, riskLevel: "high" }),
      makeNode("exception-primary", "exception", values.failure || "Handle exception", 820, 360, { owner, system, metadata: { rejoin: "terminal-recovery" } }),
      makeNode("terminal-success", "terminal", "Success", 1080, 80, { owner, system }),
      makeNode("terminal-review", "terminal", "Approved for action", 1080, 260, { owner, system }),
      makeNode("terminal-recovery", "terminal", "Manual recovery", 1080, 430, { owner, system }),
    ];
    onComplete({
      schemaVersion: 1, id: `workflow-${Date.now()}`, name: values.output ? `${values.output} workflow` : "Described workflow",
      description: `Structured from: ${values.trigger || "workflow trigger"}.`, version: "0.1.0", createdAt: now, updatedAt: now, nodes,
      edges: [
        { id: "edge-w1", source: "trigger-start", target: "decision-primary", condition: "", priority: 1, label: "evaluate", fallback: false, metadata: {} },
        { id: "edge-w2", source: "decision-primary", target: "action-success", condition: "ready", priority: 1, label: "ready", fallback: true, metadata: {} },
        { id: "edge-w3", source: "decision-primary", target: "review-primary", condition: "review", priority: 2, label: "review", fallback: false, metadata: {} },
        { id: "edge-w4", source: "action-success", target: "terminal-success", condition: "", priority: 1, label: "complete", fallback: false, metadata: {} },
        { id: "edge-w5", source: "review-primary", target: "terminal-review", condition: "", priority: 1, label: "approved", fallback: false, metadata: {} },
        { id: "edge-w6", source: "exception-primary", target: "terminal-recovery", condition: "", priority: 1, label: "recover", fallback: false, metadata: {} },
      ],
      scenarios: [{ id: "scenario-happy", name: "Happy path", description: "The described workflow succeeds.", startingTrigger: "trigger-start", inputVariables: {}, decisionOutcomes: { "decision-primary": "ready" }, expectedTerminalState: "terminal-success", expectedHumanReviewPoints: [], expectedOutputs: [values.output || "success"] }],
      policies: [], analytics: { tags: ["wizard"], lastAnalyzedAt: null, analysisRuns: 0 }, suppressedRuleIds: [],
    });
  };

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className={styles.modalHeader}>
          <div><p className={styles.eyebrow}>Structured intake</p><h2 id="wizard-title">Describe workflow</h2></div>
          <button className={styles.iconButton} onClick={onCancel} aria-label="Close workflow wizard" title="Close">×</button>
        </div>
        <p className={styles.muted}>Answer in plain language. The Studio creates a deterministic starter graph; no AI extraction is used.</p>
        <div className={styles.formGrid}>
          {questions.map(([key, label, placeholder]) => (
            <label key={key} className={styles.field}><span>{label}</span><input value={values[key] ?? ""} placeholder={placeholder} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>
          ))}
        </div>
        <div className={styles.modalActions}><button className={styles.secondaryButton} onClick={onCancel}>Cancel</button><button className={styles.primaryButton} onClick={create}>Create workflow graph</button></div>
      </section>
    </div>
  );
}
