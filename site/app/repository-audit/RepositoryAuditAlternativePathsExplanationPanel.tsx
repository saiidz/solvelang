"use client";

import { createSolveGraphAlternativePathsExplanation } from "../solve-graph/core/alternative-paths-explanation";
import type { SolveGraphAlternativePathsProductBundle } from "../solve-graph/core/alternative-paths-product";

type RepositoryAuditAlternativePathsExplanationPanelProps = {
  bundle: SolveGraphAlternativePathsProductBundle;
  className?: string;
};

export function RepositoryAuditAlternativePathsExplanationPanel({
  bundle,
  className = "",
}: RepositoryAuditAlternativePathsExplanationPanelProps) {
  const explanation = createSolveGraphAlternativePathsExplanation(bundle);

  return (
    <section
      aria-labelledby="repository-audit-alternative-path-explanation-heading"
      className={`rounded-[2rem] border border-line bg-panel p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">Alternative-path explanation</p>
          <h2 id="repository-audit-alternative-path-explanation-heading" className="mt-2 text-2xl font-semibold text-ink">
            {explanation.headline}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${explanation.status === "complete" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
          {explanation.status}
        </span>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">{explanation.detail}</p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel-alt px-3 py-1.5">{explanation.summary.availablePaths} available path(s)</span>
        <span className="rounded-full bg-panel-alt px-3 py-1.5">{explanation.summary.explainedPaths} explained path(s)</span>
        <span className="rounded-full bg-panel-alt px-3 py-1.5">{explanation.summary.statesCreated} traversal state(s)</span>
        <span className="rounded-full bg-panel-alt px-3 py-1.5">{explanation.direction}</span>
        {explanation.summary.hiddenPaths > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">{explanation.summary.hiddenPaths} hidden by presentation bound</span>
        ) : null}
        {explanation.execution.queryTruncated ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">query bounds reached</span>
        ) : null}
      </div>

      {explanation.paths.length ? (
        <div className="mt-6 grid gap-4">
          {explanation.paths.map((path) => (
            <article key={`${explanation.graphId}:path:${path.pathIndex}`} className="rounded-2xl border border-line bg-canvas p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                <span className="rounded-full bg-panel px-2.5 py-1">Path {path.pathIndex + 1}</span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800">{path.hopCount} hop(s)</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">{path.sentence}</p>

              {path.steps.length ? (
                <ol className="mt-4 grid gap-2">
                  {path.steps.map((step) => (
                    <li key={`${explanation.graphId}:${path.pathIndex}:${step.edgeId}:${step.index}`} className="rounded-xl border border-line bg-panel p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                        <span>Step {step.index}</span>
                        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800">{step.edgeKind}</span>
                      </div>
                      <p className="mt-2 break-all font-mono text-sm text-ink">{step.sentence}</p>
                      <p className="mt-2 break-all text-xs text-muted">
                        {step.from.kind} {step.from.id} → {step.to.kind} {step.to.id}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-line-strong bg-panel p-4 text-sm text-muted">
                  Zero-hop path; no traversal steps are required.
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-canvas p-6 text-sm text-muted">
          No explained path rows are available for this result.
        </div>
      )}

      {explanation.notices.length ? (
        <div className="mt-5 grid gap-2">
          {explanation.notices.map((notice) => (
            <p key={notice} className="rounded-xl border border-warning bg-warning-soft p-3 text-sm font-semibold text-warning">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-muted">
        Analyze only · explanation schema {explanation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
