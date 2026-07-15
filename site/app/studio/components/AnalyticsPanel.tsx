"use client";

import type { WorkflowAnalytics } from "../core/types";
import styles from "../studio.module.css";

const structuralLabels: Record<string, string> = { nodeCount: "Nodes", edgeCount: "Edges", decisionCount: "Decisions", exceptionPathCount: "Exception paths", humanReviewCount: "Human reviews", approvalCount: "Approvals", systemCount: "System steps", handoffCount: "Owner handoffs", averagePathDepth: "Average path depth", maximumPathDepth: "Maximum path depth", branchCount: "Branches", policyCoverage: "Policy coverage", ownerCoverage: "Owner coverage", slaCoverage: "SLA coverage", fallbackCoverage: "Fallback coverage", exceptionCoverage: "Exception coverage" };

export default function AnalyticsPanel({ analytics }: { analytics: WorkflowAnalytics }) {
  return (
    <section className={styles.viewPanel} aria-labelledby="analytics-title">
      <div className={styles.viewHeader}><div><p className={styles.eyebrow}>Local workflow analytics</p><h1 id="analytics-title">Evidence, not vanity metrics</h1><p>All values are recomputed from this graph and its local scenario runs.</p></div></div>
      <div className={styles.qualityStrip}>{Object.entries(analytics.quality).map(([key, score]) => <article key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{score.value}</strong><small>{score.formula}</small></article>)}</div>
      <div className={styles.analyticsColumns}>
        <section><div className={styles.groupTitle}><h2>Structure</h2><span>{analytics.structural.nodeCount} nodes</span></div><div className={styles.metricTable}>{Object.entries(analytics.structural).map(([key, value]) => <div key={key}><span>{structuralLabels[key] ?? key}</span><strong>{key.toLowerCase().includes("coverage") ? `${value}%` : value}</strong></div>)}</div></section>
        <section><div className={styles.groupTitle}><h2>Scenarios</h2><span>{analytics.scenario.scenarioPassRate}% pass</span></div><div className={styles.metricTable}><div><span>Expected terminal match</span><strong>{analytics.scenario.expectedTerminalMatchRate}%</strong></div><div><span>Unresolved decision rate</span><strong>{analytics.scenario.unresolvedDecisionRate}%</strong></div><div><span>Human-review coverage</span><strong>{analytics.scenario.humanReviewCoverage}%</strong></div><div><span>Average modeled cycle</span><strong>{analytics.scenario.averageModeledCycleTime}m</strong></div><div><span>Maximum modeled cycle</span><strong>{analytics.scenario.maximumModeledCycleTime}m</strong></div><div><span>Node coverage</span><strong>{analytics.scenario.nodeCoverage}%</strong></div><div><span>Edge coverage</span><strong>{analytics.scenario.edgeCoverage}%</strong></div><div><span>Path coverage</span><strong>{analytics.scenario.pathCoverage}%</strong></div></div></section>
      </div>
      <div className={styles.analyticsColumns}><section><div className={styles.groupTitle}><h2>Most traversed</h2></div>{analytics.scenario.mostFrequentlyTraversedNodes.map((id) => <div className={styles.listRow} key={id}>{id}</div>)}</section><section><div className={styles.groupTitle}><h2>Never traversed</h2><span>{analytics.scenario.neverTraversedNodes.length}</span></div>{analytics.scenario.neverTraversedNodes.length ? analytics.scenario.neverTraversedNodes.map((id) => <div className={styles.listRow} key={id}>{id}</div>) : <p className={styles.muted}>Every node has scenario coverage.</p>}</section></div>
    </section>
  );
}
