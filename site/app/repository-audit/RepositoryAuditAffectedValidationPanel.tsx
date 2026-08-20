import type { RepositoryAffectedValidationMap } from "./core/affectedValidation";

type RepositoryAuditAffectedValidationPanelProps = {
  analysis: RepositoryAffectedValidationMap;
  className?: string;
};

export function RepositoryAuditAffectedValidationPanel({
  analysis,
  className = "",
}: RepositoryAuditAffectedValidationPanelProps) {
  const entry = analysis.entries[0];
  if (!entry) return null;

  return (
    <section className={`rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">Affected validation</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Tests and workflows for the selected path</h3>
        </div>
        <p className="text-sm text-slate-600">
          {entry.tests.length} test(s) · {entry.workflows.length} workflow reference(s)
        </p>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">
        This is bounded structural evidence for <code className="font-semibold">{entry.changedPath}</code>. It suggests validation targets from the analyzed graph and explicit workflow paths; it does not claim behavioral test coverage.
      </p>

      {analysis.status === "partial" ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Validation evidence is partial. A graph, workflow, traversal, or presentation bound was reached, or the selected path could not be fully resolved.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Affected tests</h4>
          <div className="mt-2 grid gap-2">
            {entry.tests.length ? entry.tests.map((test) => (
              <article key={`${test.testPath}-${test.nodeId}`} className="rounded-xl border border-emerald-100 bg-white p-3">
                <code className="block break-all text-xs font-semibold text-slate-900">{test.testPath}</code>
                <p className="mt-1 text-xs text-slate-500">Graph distance {test.depth}</p>
              </article>
            )) : (
              <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-4 text-sm text-slate-600">
                No affected test file was observed inside the configured bounded traversal.
              </p>
            )}
          </div>
          {entry.testsTruncated ? <p className="mt-2 text-xs font-semibold text-amber-800">Additional test mappings were hidden by the configured result cap.</p> : null}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-900">Affected workflows</h4>
          <div className="mt-2 grid gap-2">
            {entry.workflows.length ? entry.workflows.map((workflow) => (
              <article key={`${workflow.workflowPath}-${workflow.kind}-${workflow.targetPath}-${workflow.evidence.line}`} className="rounded-xl border border-emerald-100 bg-white p-3">
                <code className="block break-all text-xs font-semibold text-slate-900">{workflow.workflowPath}:{workflow.evidence.line}</code>
                <p className="mt-1 break-all text-xs text-slate-600">{workflow.kind} → {workflow.targetPath}</p>
              </article>
            )) : (
              <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-4 text-sm text-slate-600">
                No explicit workflow-path reference was observed for the selected path.
              </p>
            )}
          </div>
          {entry.workflowsTruncated ? <p className="mt-2 text-xs font-semibold text-amber-800">Additional workflow mappings were hidden by the configured result cap.</p> : null}
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Max depth {analysis.execution.maxDepth} · traversal cap {analysis.execution.maxTraversalResults} · test cap {analysis.execution.maxTestsPerPath} · workflow cap {analysis.execution.maxWorkflowsPerPath} · network access disabled · write access disabled
      </p>
    </section>
  );
}
