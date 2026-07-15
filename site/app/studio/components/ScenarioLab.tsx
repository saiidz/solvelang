"use client";

import { useMemo, useState } from "react";
import { compareScenarioRuns } from "../core/comparison";
import { simulateScenario } from "../core/simulation";
import type { ScenarioRun, WorkflowDocument, WorkflowScenario } from "../core/types";
import styles from "../studio.module.css";

export default function ScenarioLab({ workflow, selectedScenarioId, onSelectScenario, onUpdateScenarios, onRun, onOpenComparison }: {
  workflow: WorkflowDocument; selectedScenarioId: string | null; onSelectScenario: (id: string) => void;
  onUpdateScenarios: (scenarios: WorkflowScenario[]) => void; onRun: (run: ScenarioRun) => void;
  onOpenComparison: () => void;
}) {
  const scenario = workflow.scenarios.find((item) => item.id === selectedScenarioId) ?? workflow.scenarios[0] ?? null;
  const [baselineId, setBaselineId] = useState(workflow.scenarios[0]?.id ?? "");
  const decisions = workflow.nodes.filter((node) => node.type === "decision");
  const update = (patch: Partial<WorkflowScenario>) => scenario && onUpdateScenarios(workflow.scenarios.map((item) => item.id === scenario.id ? { ...item, ...patch } : item));
  const currentRun = useMemo(() => scenario ? simulateScenario(workflow, scenario) : null, [workflow, scenario]);
  const baseline = workflow.scenarios.find((item) => item.id === baselineId);
  const comparison = baseline && currentRun ? compareScenarioRuns(workflow, simulateScenario(workflow, baseline), currentRun) : null;

  const add = () => {
    const next: WorkflowScenario = { id: `scenario-${Date.now()}`, name: "New scenario", description: "", startingTrigger: workflow.nodes.find((node) => node.type === "trigger")?.id ?? "", inputVariables: {}, decisionOutcomes: {}, expectedTerminalState: "", expectedHumanReviewPoints: [], expectedOutputs: [] };
    onUpdateScenarios([...workflow.scenarios, next]); onSelectScenario(next.id);
  };
  const duplicate = () => { if (!scenario) return; const next = { ...structuredClone(scenario), id: `scenario-${Date.now()}`, name: `${scenario.name} copy` }; onUpdateScenarios([...workflow.scenarios, next]); onSelectScenario(next.id); };

  return (
    <section className={styles.viewPanel} aria-labelledby="scenario-title">
      <div className={styles.viewHeader}><div><p className={styles.eyebrow}>Scenario Lab</p><h1 id="scenario-title">Test the workflow before automation</h1><p>Choose explicit outcomes and inspect the path. The simulator never guesses.</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} onClick={add}>+ Scenario</button><button className={styles.secondaryButton} disabled={!scenario} onClick={duplicate}>Duplicate</button><button className={styles.primaryButton} disabled={!currentRun} onClick={() => currentRun && onRun(currentRun)}>Run scenario</button></div></div>
      <div className={styles.scenarioLayout}>
        <nav className={styles.scenarioList} aria-label="Scenarios">{workflow.scenarios.map((item) => <button key={item.id} className={item.id === scenario?.id ? styles.scenarioSelected : ""} onClick={() => onSelectScenario(item.id)}><strong>{item.name}</strong><span>{item.description || "No description"}</span></button>)}</nav>
        {scenario ? <div className={styles.scenarioEditor}>
          <div className={styles.twoFields}><label className={styles.field}><span>Name</span><input value={scenario.name} onChange={(event) => update({ name: event.target.value })} /></label><label className={styles.field}><span>Starting trigger</span><select value={scenario.startingTrigger} onChange={(event) => update({ startingTrigger: event.target.value })}>{workflow.nodes.filter((node) => node.type === "trigger").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label></div>
          <label className={styles.field}><span>Description</span><textarea rows={2} value={scenario.description} onChange={(event) => update({ description: event.target.value })} /></label>
          <div className={styles.decisionInputs}><h2>Decision outcomes</h2>{decisions.map((decision) => { const options = workflow.edges.filter((edge) => edge.source === decision.id); return <label className={styles.field} key={decision.id}><span>{decision.title}</span><select value={scenario.decisionOutcomes[decision.id] ?? ""} onChange={(event) => update({ decisionOutcomes: { ...scenario.decisionOutcomes, [decision.id]: event.target.value } })}><option value="">Unresolved</option>{options.map((edge) => <option key={edge.id} value={edge.condition || edge.label}>{edge.label || edge.condition || "Unnamed branch"}{edge.fallback ? " (fallback)" : ""}</option>)}</select></label>; })}</div>
          <div className={styles.threeFields}><label className={styles.field}><span>Expected terminal</span><select value={scenario.expectedTerminalState} onChange={(event) => update({ expectedTerminalState: event.target.value })}><option value="">No expectation</option>{workflow.nodes.filter((node) => node.type === "terminal").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><label className={styles.field}><span>Expected review IDs</span><input value={scenario.expectedHumanReviewPoints.join(", ")} onChange={(event) => update({ expectedHumanReviewPoints: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label><label className={styles.field}><span>Expected outputs</span><input value={scenario.expectedOutputs.join(", ")} onChange={(event) => update({ expectedOutputs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label></div>
          {currentRun ? <div className={currentRun.passed ? styles.runSuccess : styles.runFailure}><strong>{currentRun.passed ? "Scenario passes" : "Scenario needs attention"}</strong><span>{currentRun.path.length} steps · {currentRun.elapsedSlaMinutes} modeled minutes · {currentRun.humanReviewPauses.length} human pauses</span>{currentRun.failures.map((failure) => <small key={failure}>{failure}</small>)}</div> : null}
        </div> : <div className={styles.emptyState}><strong>No scenarios yet</strong><p>Create a scenario to model one possible execution path.</p></div>}
      </div>
      {comparison ? <section className={styles.comparison}><div className={styles.comparisonHeader}><div><p className={styles.eyebrow}>Counterfactual comparison</p><h2>What changes?</h2></div><label className={styles.field}><span>Compare against</span><select value={baselineId} onChange={(event) => { setBaselineId(event.target.value); onOpenComparison(); }}>{workflow.scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className={styles.comparisonGrid}><div><span>Path added</span><strong>{comparison.path.added.length}</strong></div><div><span>Owner changes</span><strong>{comparison.owners.added.length + comparison.owners.removed.length}</strong></div><div><span>Human reviews</span><strong>{comparison.humanReview.added.length}</strong></div><div><span>SLA change</span><strong>{comparison.sla.delta > 0 ? "+" : ""}{comparison.sla.delta}m</strong></div><div><span>Risk changed</span><strong>{comparison.risk.changed ? "Yes" : "No"}</strong></div><div><span>Terminal changed</span><strong>{comparison.terminal.changed ? "Yes" : "No"}</strong></div></div></section> : null}
    </section>
  );
}
