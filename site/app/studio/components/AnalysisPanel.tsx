"use client";

import type { WorkflowAnalysis } from "../core/types";
import styles from "../studio.module.css";

export default function AnalysisPanel({ analysis, onOpenFinding, onToggleSuppression }: { analysis: WorkflowAnalysis; onOpenFinding: (id: string | null) => void; onToggleSuppression: (ruleId: string) => void }) {
  const groups = ["error", "warning", "recommendation"] as const;
  return (
    <section className={styles.viewPanel} aria-labelledby="analysis-title">
      <div className={styles.viewHeader}>
        <div><p className={styles.eyebrow}>Deterministic rule inspector</p><h1 id="analysis-title">Workflow analysis</h1><p>No AI inference. Every result is reproducible from the workflow graph.</p></div>
        <div className={styles.scoreDial} aria-label={`Automation readiness ${analysis.score.value} out of 100`}><strong>{analysis.score.value}</strong><span>/100 readiness</span></div>
      </div>
      <div className={styles.formulaBand}><strong>Formula</strong><span>{analysis.score.formula}</span></div>
      <div className={styles.findingColumns}>
        {groups.map((severity) => {
          const findings = analysis.findings.filter((item) => item.severity === severity);
          return <section key={severity} className={styles.findingGroup}><div className={styles.groupTitle}><h2>{severity === "error" ? "Errors" : severity === "warning" ? "Warnings" : "Recommendations"}</h2><span>{findings.length}</span></div>{findings.length ? findings.map((finding) => (
            <article key={finding.id} className={`${styles.finding} ${finding.suppressed ? styles.suppressed : ""}`}>
              <button onClick={() => onOpenFinding(finding.affectedId)}><span className={styles.ruleId}>{finding.ruleId}</span><strong>{finding.title}</strong><p>{finding.explanation}</p><small>{finding.remediation}</small></button>
              {finding.suppressible ? <button className={styles.textButton} onClick={() => onToggleSuppression(finding.ruleId)}>{finding.suppressed ? "Restore finding" : "Suppress"}</button> : null}
            </article>
          )) : <p className={styles.muted}>No {severity} findings.</p>}</section>;
        })}
      </div>
      <section className={styles.passedSection}><div className={styles.groupTitle}><h2>Passed checks</h2><span>{analysis.passedChecks.length}</span></div><div className={styles.passedGrid}>{analysis.passedChecks.map((check) => <div key={check.ruleId}><span>✓</span><strong>{check.ruleId}</strong> {check.title}</div>)}</div></section>
      <section className={styles.factorSection}><h2>Score factors</h2>{analysis.score.factors.map((factor) => <div key={factor.label} className={styles.factorRow}><span>{factor.label}</span><div className={styles.factorTrack}><i style={{ width: `${Math.max(0, 100 - factor.deduction * 4)}%` }} /></div><strong>−{factor.deduction}</strong></div>)}</section>
    </section>
  );
}
