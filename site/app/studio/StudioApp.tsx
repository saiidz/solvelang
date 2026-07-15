"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Browser storage hydration and debounced autosave synchronize external local state. */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import AnalysisPanel from "./components/AnalysisPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ExportPanel from "./components/ExportPanel";
import Inspector from "./components/Inspector";
import ScenarioLab from "./components/ScenarioLab";
import TracePanel from "./components/TracePanel";
import VersionsPanel from "./components/VersionsPanel";
import WorkflowCanvas from "./components/WorkflowCanvas";
import WorkflowWizard from "./components/WorkflowWizard";
import { analyzeWorkflow } from "./core/analysis";
import { calculateWorkflowAnalytics } from "./core/analytics";
import { downloadText, serializeWorkflow } from "./core/exports";
import { createLocalAnalytics } from "./core/productAnalytics";
import { parseWorkflowDocument } from "./core/schema";
import { simulateScenario } from "./core/simulation";
import { createArtifactRepository, createProjectRepository } from "./core/storage";
import { createBlankWorkflow, createSupportTriageDocument, makeNode, workflowTemplates } from "./core/templates";
import type { NodeType, ScenarioRun, VersionSnapshot, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowScenario } from "./core/types";
import { createVersionSnapshot } from "./core/versions";
import styles from "./studio.module.css";

type View = "projects" | "canvas" | "analysis" | "scenarios" | "trace" | "analytics" | "versions" | "export";
const views: Array<{ id: View; label: string; short: string }> = [
  { id: "projects", label: "Projects", short: "Projects" }, { id: "canvas", label: "Workflow Canvas", short: "Canvas" },
  { id: "analysis", label: "Rule Inspector", short: "Rules" }, { id: "scenarios", label: "Scenario Lab", short: "Scenarios" },
  { id: "trace", label: "Run Trace", short: "Trace" }, { id: "analytics", label: "Analytics", short: "Analytics" },
  { id: "versions", label: "Versions", short: "Versions" }, { id: "export", label: "Export", short: "Export" },
];

function freshCopy(source: WorkflowDocument, suffix = "") {
  const copy = structuredClone(source);
  const now = new Date().toISOString();
  copy.id = `workflow-${crypto.randomUUID()}`;
  copy.name = `${copy.name}${suffix}`; copy.createdAt = now; copy.updatedAt = now; copy.version = "0.1.0";
  return copy;
}

export default function StudioApp() {
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() => freshCopy(createSupportTriageDocument(), " workspace"));
  const [projects, setProjects] = useState<WorkflowDocument[]>([]);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [traces, setTraces] = useState<ScenarioRun[]>([]);
  const [activeView, setActiveView] = useState<View>("projects");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(workflow.scenarios[0]?.id ?? null);
  const [activeRun, setActiveRun] = useState<ScenarioRun | null>(null);
  const [saveStatus, setSaveStatus] = useState("Preparing local workspace…");
  const [message, setMessage] = useState("Studio data stays in this browser.");
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const repository = useMemo(() => mounted ? createProjectRepository(window.localStorage) : null, [mounted]);
  const artifacts = useMemo(() => mounted ? createArtifactRepository(window.localStorage) : null, [mounted]);
  const productAnalytics = useMemo(() => mounted ? createLocalAnalytics(window.localStorage) : null, [mounted]);
  const analysis = useMemo(() => analyzeWorkflow(workflow), [workflow]);
  const scenarioRuns = useMemo(() => workflow.scenarios.map((scenario) => simulateScenario(workflow, scenario)), [workflow]);
  const analytics = useMemo(() => calculateWorkflowAnalytics(workflow, scenarioRuns), [workflow, scenarioRuns]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!repository || !artifacts || !productAnalytics) return;
    productAnalytics.track("studio_opened");
    const loaded = repository.loadAll();
    if (loaded.status !== "ok") {
      setMessage(loaded.status === "corrupt" ? `Stored project data could not be read and was quarantined: ${loaded.error}` : "Browser storage is unavailable. Changes cannot be persisted in this session.");
      setSaveStatus(loaded.status === "corrupt" ? "Recovery needed" : "Storage unavailable");
      if (loaded.status === "corrupt") setRecoveryRaw(repository.recovery()?.raw ?? null);
      return;
    }
    if (loaded.documents.length) {
      const first = loaded.documents[0];
      setProjects(loaded.documents); setWorkflow(first); setVersions(artifacts.loadVersions(first.id));
      setTraces(artifacts.loadTraces(first.id)); setSelectedScenarioId(first.scenarios[0]?.id ?? null);
    } else {
      repository.save(workflow); setProjects([workflow]); setVersions(createVersionSnapshot(workflow, "Initial model", "Created from support triage template", []));
    }
    setSaveStatus("Saved locally");
  // Initial load intentionally runs once after storage adapters exist.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, artifacts, productAnalytics]);

  useEffect(() => {
    if (!mounted || !repository || !artifacts) return;
    setSaveStatus("Saving locally…");
    const timer = window.setTimeout(() => {
      const result = repository.save(workflow);
      if (result.status !== "ok") { setSaveStatus("Save blocked"); setMessage(result.error); return; }
      const nextVersions = createVersionSnapshot(workflow, "Autosave", "Workflow edited in Studio", versions);
      if (!artifacts.saveVersions(workflow.id, nextVersions) || !artifacts.saveTraces(workflow.id, traces)) { setSaveStatus("Save blocked"); setMessage("Browser storage is full or unavailable. Export this workflow before leaving."); return; }
      setVersions(nextVersions);
      setProjects(repository.list()); setSaveStatus("Saved locally");
    }, 550);
    return () => window.clearTimeout(timer);
  // Version updates are outputs of this autosave and must not retrigger it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, traces, mounted, repository, artifacts]);

  useEffect(() => {
    if (!mounted || !repository || !artifacts) return;
    const flushPendingChanges = () => {
      const result = repository.save(workflow);
      if (result.status !== "ok") return;
      artifacts.saveVersions(workflow.id, createVersionSnapshot(workflow, "Autosave", "Workflow edited in Studio", versions));
      artifacts.saveTraces(workflow.id, traces);
    };
    window.addEventListener("pagehide", flushPendingChanges);
    return () => window.removeEventListener("pagehide", flushPendingChanges);
  }, [workflow, traces, versions, mounted, repository, artifacts]);

  const replaceWorkflow = (next: WorkflowDocument, status = "Workflow updated") => {
    setWorkflow({ ...next, updatedAt: new Date().toISOString() }); setSelectedNodeId(next.nodes[0]?.id ?? null);
    setSelectedScenarioId(next.scenarios[0]?.id ?? null); setActiveRun(null); setMessage(status);
  };
  const mutate = (fn: (current: WorkflowDocument) => WorkflowDocument, event?: Parameters<NonNullable<typeof productAnalytics>["track"]>[0]) => {
    setWorkflow((current) => ({ ...fn(structuredClone(current)), updatedAt: new Date().toISOString() }));
    if (event) productAnalytics?.track(event);
  };
  const openProject = (project: WorkflowDocument) => {
    setWorkflow(project); setVersions(artifacts?.loadVersions(project.id) ?? []); setTraces(artifacts?.loadTraces(project.id) ?? []);
    setSelectedNodeId(project.nodes[0]?.id ?? null); setSelectedScenarioId(project.scenarios[0]?.id ?? null); setActiveRun(null); setActiveView("canvas");
  };
  const createProject = (source: WorkflowDocument, sourceLabel: string) => {
    const next = freshCopy(source); repository?.save(next); setProjects(repository?.list() ?? [next, ...projects]); setVersions([]); setTraces([]);
    replaceWorkflow(next, `${sourceLabel} created locally.`); productAnalytics?.track(sourceLabel === "Blank workflow" ? "project_created" : "template_selected"); setActiveView("canvas");
  };
  const importFile = async (file: File) => {
    try {
      const result = parseWorkflowDocument(JSON.parse(await file.text()));
      if (!result.ok) { setMessage(`Import failed: ${result.error}`); return; }
      const next = freshCopy(result.document, " imported"); repository?.save(next); productAnalytics?.track("workflow_imported"); openProject(next); setMessage("Workflow imported and saved locally.");
    } catch (error) { setMessage(`Import failed: ${error instanceof Error ? error.message : "Invalid JSON file."}`); }
  };
  const deleteProject = (project: WorkflowDocument) => {
    if (!window.confirm(`Export and delete “${project.name}” from this browser?`)) return;
    downloadText(`${project.name.toLowerCase().replaceAll(" ", "-")}.json`, serializeWorkflow(project), "application/json");
    repository?.delete(project.id); artifacts?.deleteProjectArtifacts(project.id); const remaining = repository?.list() ?? [];
    setProjects(remaining); if (project.id === workflow.id) { const next = remaining[0] ?? freshCopy(createBlankWorkflow()); replaceWorkflow(next, "Project exported and deleted locally."); }
  };
  const resetCorruptStorage = () => {
    if (!repository || !window.confirm("Delete the corrupt stored collection after downloading it?")) return;
    if (recoveryRaw) downloadText("solvelang-studio-recovery.txt", recoveryRaw, "text/plain");
    if (!repository.resetCorrupt()) { setMessage("Browser storage could not be reset."); return; }
    const next = freshCopy(createSupportTriageDocument(), " workspace");
    const result = repository.save(next);
    if (result.status !== "ok") { setMessage(result.error); return; }
    setRecoveryRaw(null); setProjects([next]); setVersions([]); setTraces([]); replaceWorkflow(next, "Corrupt storage was exported and reset locally."); setSaveStatus("Saved locally");
  };

  const addNode = () => mutate((current) => { const index = current.nodes.length; current.nodes.push(makeNode(`node-${crypto.randomUUID()}`, "action" as NodeType, "New action", 220 + (index % 4) * 230, 120 + Math.floor(index / 4) * 150, { metadata: { errorPath: "define-exception" } })); return current; }, "node_created");
  const updateNode = (node: WorkflowNode) => mutate((current) => { current.nodes = current.nodes.map((item) => item.id === node.id ? node : item); return current; }, "node_updated");
  const duplicateNode = (id: string) => mutate((current) => { const source = current.nodes.find((node) => node.id === id); if (source) { const copy = structuredClone(source); copy.id = `${source.id}-copy-${crypto.randomUUID()}`; copy.title = `${source.title} copy`; copy.position = { x: source.position.x + 36, y: source.position.y + 100 }; current.nodes.push(copy); setSelectedNodeId(copy.id); } return current; }, "node_created");
  const deleteNode = (id: string) => { if (!window.confirm("Delete this node and all connected edges?")) return; mutate((current) => { current.nodes = current.nodes.filter((node) => node.id !== id); current.edges = current.edges.filter((edge) => edge.source !== id && edge.target !== id); return current; }); setSelectedNodeId(null); };
  const connectNodes = (source: string, target: string) => mutate((current) => { current.edges.push({ id: `edge-${crypto.randomUUID()}`, source, target, condition: "", priority: (current.edges.filter((edge) => edge.source === source).length + 1), label: "next", fallback: false, metadata: {} }); return current; }, "edge_created");
  const updateEdge = (edge: WorkflowEdge) => mutate((current) => { current.edges = current.edges.map((item) => item.id === edge.id ? edge : item); return current; });
  const deleteEdge = (id: string) => mutate((current) => { current.edges = current.edges.filter((edge) => edge.id !== id); return current; });
  const runScenario = (run: ScenarioRun) => { setActiveRun(run); setTraces((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50)); productAnalytics?.track("scenario_run"); setActiveView("trace"); };

  const activeContent = activeView === "projects" ? (
    <section className={styles.projectHome} aria-labelledby="studio-title">
      <div className={styles.projectHero}><div><p className={styles.eyebrow}>Local-first workflow intelligence</p><h1 id="studio-title">Model the operation. Test the decisions. Export the evidence.</h1><p>SolveLang Studio helps you inspect workflow policy, failure paths, human review, and scenario behavior before automation. No workflow data leaves this browser.</p></div><div className={styles.readinessSummary}><span>Current readiness</span><strong>{analysis.score.value}</strong><small>{analysis.findings.filter((item) => !item.suppressed).length} open findings</small></div></div>
      <div className={styles.startActions}><button onClick={() => createProject(createBlankWorkflow(), "Blank workflow")}><span>01</span><strong>Create blank workflow</strong><small>Start from an empty canonical model.</small></button><button onClick={() => setShowWizard(true)}><span>02</span><strong>Describe workflow</strong><small>Answer seven structured questions.</small></button><button onClick={() => fileInput.current?.click()}><span>03</span><strong>Import workflow JSON</strong><small>Validate a user-selected local file.</small></button></div>
      <section className={styles.templateSection}><div className={styles.groupTitle}><div><p className={styles.eyebrow}>Included operational models</p><h2>Start from a template</h2></div><span>5 templates</span></div><div className={styles.templateRail}>{workflowTemplates.map((template, index) => <button key={template.key} onClick={() => createProject(template.document, template.name)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{template.name}</strong><small>{template.document.description}</small><em>{template.document.nodes.length} nodes · {template.document.scenarios.length} scenarios</em></button>)}</div></section>
      <section className={styles.recentProjects}><div className={styles.groupTitle}><div><p className={styles.eyebrow}>This browser</p><h2>Projects</h2></div><span>{projects.length}</span></div>{projects.length ? projects.map((project) => <article key={project.id}><button onClick={() => openProject(project)}><strong>{project.name}</strong><span>{project.description || "No description"}</span><small>{project.nodes.length} nodes · updated {new Date(project.updatedAt).toLocaleString()}</small></button><button className={styles.textButton} onClick={() => deleteProject(project)}>Export & delete</button></article>) : <div className={styles.emptyState}><strong>No saved projects</strong><p>Create one above. It will remain in this browser.</p></div>}</section>
    </section>
  ) : activeView === "canvas" ? (
    <div className={styles.canvasLayout}><div className={styles.canvasStack}><WorkflowCanvas workflow={workflow} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onMoveNode={(id, x, y) => mutate((current) => { const node = current.nodes.find((item) => item.id === id); if (node) node.position = { x, y }; return current; })} onAddNode={addNode} onDuplicateNode={duplicateNode} onDeleteNode={deleteNode} onConnect={connectNodes} /><TracePanel key={activeRun?.id ?? "empty-compact-trace"} run={activeRun} compact onJumpToNode={(id) => setSelectedNodeId(id)} /></div><Inspector workflow={workflow} selectedNodeId={selectedNodeId} onUpdateNode={updateNode} onUpdateEdge={updateEdge} onDeleteEdge={deleteEdge} onSelectNode={setSelectedNodeId} /></div>
  ) : activeView === "analysis" ? <AnalysisPanel analysis={analysis} onOpenFinding={(id) => { if (id) setSelectedNodeId(id); productAnalytics?.track("finding_opened"); setActiveView("canvas"); }} onToggleSuppression={(ruleId) => { mutate((current) => { current.suppressedRuleIds = current.suppressedRuleIds.includes(ruleId) ? current.suppressedRuleIds.filter((id) => id !== ruleId) : [...current.suppressedRuleIds, ruleId]; return current; }); productAnalytics?.track("finding_resolved"); }} />
  : activeView === "scenarios" ? <ScenarioLab workflow={workflow} selectedScenarioId={selectedScenarioId} onSelectScenario={setSelectedScenarioId} onUpdateScenarios={(scenarios: WorkflowScenario[]) => mutate((current) => { current.scenarios = scenarios; return current; }, "scenario_created")} onRun={runScenario} onOpenComparison={() => productAnalytics?.track("comparison_opened")} />
  : activeView === "trace" ? <TracePanel key={(activeRun ?? traces[0])?.id ?? "empty-trace"} run={activeRun ?? traces[0] ?? null} onJumpToNode={(id) => { setSelectedNodeId(id); setActiveView("canvas"); }} />
  : activeView === "analytics" ? <AnalyticsPanel analytics={analytics} />
  : activeView === "versions" ? <VersionsPanel versions={versions} onRestore={(version) => { const preserved = createVersionSnapshot(workflow, "Before restore", `Before restoring ${version.label}`, versions); setVersions(preserved); replaceWorkflow(structuredClone(version.document), `${version.label} restored.`); }} onDuplicate={(version) => createProject(version.document, `${version.label} duplicate`)} />
  : <ExportPanel workflow={workflow} analysis={analysis} analytics={analytics} traces={traces} onExport={() => productAnalytics?.track("export_created")} />;

  return (
    <div className={styles.studio}>
      <a href="#studio-main" className={styles.skipLink}>Skip to Studio workspace</a>
      <header className={styles.topbar}><Link href="/" aria-label="SolveLang home"><Image src="/solvelang-mark-mono.svg" alt="" width={32} height={32} priority /><span className={styles.brandText}>Solve<em>Lang</em></span></Link><div className={styles.projectIdentity}><input aria-label="Project name" value={workflow.name} onChange={(event) => mutate((current) => { current.name = event.target.value; return current; })} /><span>{workflow.version} · {saveStatus}</span></div><div className={styles.topActions}><span className={styles.localBadge}>Local only</span><Link href="/run/">Script preview</Link><Link href="/">Exit Studio</Link></div></header>
      <nav className={styles.mobileTabs} aria-label="Studio views">{views.map((view) => <button key={view.id} aria-current={activeView === view.id ? "page" : undefined} onClick={() => { setActiveView(view.id); if (view.id === "analysis") productAnalytics?.track("analysis_run"); }}>{view.short}</button>)}</nav>
      <div className={styles.appBody}>
        <aside className={styles.sidebar}><div className={styles.sideTitle}><span>Workflow Intelligence</span><strong>Studio v1</strong></div><nav aria-label="Studio navigation">{views.map((view, index) => <button key={view.id} className={activeView === view.id ? styles.navActive : ""} onClick={() => { setActiveView(view.id); if (view.id === "analysis") productAnalytics?.track("analysis_run"); }}><span>{String(index + 1).padStart(2, "0")}</span>{view.label}{view.id === "analysis" ? <em>{analysis.findings.filter((item) => !item.suppressed).length}</em> : null}</button>)}</nav><div className={styles.privacyRail}><strong>Private by architecture</strong><p>Projects, traces, versions, and usage counters stay in browser storage.</p></div></aside>
        <main id="studio-main" className={styles.main} tabIndex={-1}><div className={styles.statusBar} role="status" aria-live="polite"><span>{message}</span>{recoveryRaw ? <span className={styles.recoveryActions}><button onClick={() => downloadText("solvelang-studio-recovery.txt", recoveryRaw, "text/plain")}>Download recovery data</button><button onClick={resetCorruptStorage}>Export & reset corrupt data</button></span> : <strong>{workflow.nodes.length} nodes · {workflow.edges.length} edges · {workflow.scenarios.length} scenarios</strong>}</div>{activeContent}</main>
      </div>
      <input ref={fileInput} className={styles.hiddenInput} type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} />
      {showWizard ? <WorkflowWizard onCancel={() => setShowWizard(false)} onComplete={(next) => { setShowWizard(false); createProject(next, "Structured workflow"); }} /> : null}
    </div>
  );
}
