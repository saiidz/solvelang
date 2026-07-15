"use client";

import { copyText, downloadText, exportAnalyticsCsv, exportMarkdownReport, exportPrintableHtml, generateSolveLangDraft, serializeAnalytics, serializeFindings, serializeTraces, serializeWorkflow } from "../core/exports";
import type { ScenarioRun, WorkflowAnalysis, WorkflowAnalytics, WorkflowDocument } from "../core/types";
import styles from "../studio.module.css";

export default function ExportPanel({ workflow, analysis, analytics, traces, onExport }: { workflow: WorkflowDocument; analysis: WorkflowAnalysis; analytics: WorkflowAnalytics; traces: ScenarioRun[]; onExport: () => void }) {
  const slug = workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow";
  const exports = [
    ["Workflow JSON", "Canonical local workflow document.", `${slug}.json`, serializeWorkflow(workflow), "application/json"],
    ["Analysis findings JSON", "Every deterministic finding and evidence item.", `${slug}-findings.json`, serializeFindings(analysis), "application/json"],
    ["Analytics JSON", "Structural, scenario, and quality metrics.", `${slug}-analytics.json`, serializeAnalytics(analytics), "application/json"],
    ["Analytics CSV", "Flat metric export for spreadsheets.", `${slug}-analytics.csv`, exportAnalyticsCsv(analytics), "text/csv"],
    ["Scenario traces JSON", "Local execution paths and trace events.", `${slug}-traces.json`, serializeTraces(traces), "application/json"],
    ["Workflow X-Ray Markdown", "Readable evidence report for review.", `${slug}-x-ray.md`, exportMarkdownReport(workflow, analysis, analytics), "text/markdown"],
    ["Printable HTML", "Self-contained local report for printing.", `${slug}-x-ray.html`, exportPrintableHtml(workflow, analysis, analytics), "text/html"],
    ["SolveLang draft", "Preliminary draft with unsupported concepts kept as comments.", `${slug}.solve`, generateSolveLangDraft(workflow), "text/plain"],
  ] as const;
  return (
    <section className={styles.viewPanel} aria-labelledby="export-title">
      <div className={styles.viewHeader}><div><p className={styles.eyebrow}>Exportable evidence</p><h1 id="export-title">Take the workflow with you</h1><p>Every file is generated locally. The SolveLang script is a draft; validate it with the Rust CLI before running.</p></div></div>
      <div className={styles.exportList}>{exports.map(([title, note, filename, content, mime]) => <article key={title} className={styles.exportRow}><div><strong>{title}</strong><p>{note}</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} onClick={async () => { await copyText(content); onExport(); }}>Copy</button><button className={styles.primaryButton} onClick={() => { downloadText(filename, content, mime); onExport(); }}>Download</button></div></article>)}</div>
      <div className={styles.boundaryNote}><strong>Runtime boundary</strong><p>Studio models are broader than the executable language. Full `.solve` validation and execution remain canonical in the local Rust CLI.</p><a href="/run/">Open the simple browser script preview →</a></div>
    </section>
  );
}
