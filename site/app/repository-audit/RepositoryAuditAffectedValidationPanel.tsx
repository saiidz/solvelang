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
    <section className={`rounded-[2rem] border border-success bg-success-soft p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-success">Affected validation</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">Tests and workflows for the selected path</h3>
        </div>
        <p className="text-sm text-muted">
          {entry.tests.length} test(s) · {entry.workflows.length} workflow reference(s)
        </p>
      </div>

      <p className="mt-3 text-sm leading-6 text-body">
        This is bounded structural evidence for <code className="font-semibold">{entry.changedPath}</code>. It suggests validation targets from the analyzed graph and explicit workflow paths; it does not claim behavioral test coverage.
      </p>

      {analysis.status === "partial" ? (
        <p className="mt-4 rounded-xl border border-warning bg-warning-soft p-3 text-sm font-semibold text-warning">
          Validation evidence is partial. A graph, workflow, traversal, or presentation bound was reached, or the selected path could not be fully resolved.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">Affected tests</h4>
          <div className="mt-2 grid gap-2">
            {entry.tests.length ? entry.tests.map((test) => (
              <article key={`${test.testPath}-${test.nodeId}`} className="rounded-xl border border-success bg-panel p-3">
                <code className="block break-all text-xs font-semibold text-ink">{test.testPath}</code>
                <p className="mt-1 text-xs text-muted">Graph distance {test.depth}</p>
              </article>
            )) : (
              <p className="rounded-xl border border-dashed border-success bg-panel p-4 text-sm text-muted">
                No affected test file was observed inside the configured bounded traversal.
              </p>
            )}
          </div>
          {entry.testsTruncated ? <p className="mt-2 text-xs font-semibold text-warning">Additional test mappings were hidden by the configured result cap.</p> : null}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-ink">Affected workflows</h4>
          <div className="mt-2 grid gap-2">
            {entry.workflows.length ? entry.workflows.map((workflow) => (
              <article key={`${workflow.workflowPath}-${workflow.kind}-${workflow.targetPath}-${workflow.evidence.line}`} className="rounded-xl border border-success bg-panel p-3">
                <code className="block break-all text-xs font-semibold text-ink">{workflow.workflowPath}:{workflow.evidence.line}</code>
                <p className="mt-1 break-all text-xs text-muted">{workflow.kind} → {workflow.targetPath}</p>
              </article>
            )) : (
              <p className="rounded-xl border border-dashed border-success bg-panel p-4 text-sm text-muted">
                No explicit workflow-path reference was observed for the selected path.
              </p>
            )}
          </div>
          {entry.workflowsTruncated ? <p className="mt-2 text-xs font-semibold text-warning">Additional workflow mappings were hidden by the configured result cap.</p> : null}
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Max depth {analysis.execution.maxDepth} · traversal cap {analysis.execution.maxTraversalResults} · test cap {analysis.execution.maxTestsPerPath} · workflow cap {analysis.execution.maxWorkflowsPerPath} · network access disabled · write access disabled
      </p>
    </section>
  );
}
