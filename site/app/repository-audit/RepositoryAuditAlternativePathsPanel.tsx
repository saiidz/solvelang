"use client";

import type { SolveGraphAlternativePathsPresentation } from "../solve-graph/core/alternative-paths-presentation";

type RepositoryAuditAlternativePathsPanelProps = {
  presentation: SolveGraphAlternativePathsPresentation;
  className?: string;
};

function directionLabel(direction: SolveGraphAlternativePathsPresentation["direction"]): string {
  return direction === "dependencies" ? "dependency paths" : "dependent paths";
}

export function RepositoryAuditAlternativePathsPanel({
  presentation,
  className = "",
}: RepositoryAuditAlternativePathsPanelProps) {
  return (
    <section className={`rounded-[2rem] border border-accent bg-accent-soft p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Solve Graph alternatives</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Bounded {directionLabel(presentation.direction)}</h2>
        </div>
        <p className="text-sm text-muted">
          {presentation.summary.shownPaths} shown · {presentation.summary.availablePaths} returned
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        SolveLang shows deterministic simple paths already returned by the bounded graph query. Query limits and presentation limits remain separate, so a partial result is never presented as complete coverage.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.availablePaths} path(s)</span>
        {presentation.summary.minimumHops !== undefined ? (
          <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.minimumHops} min hop(s)</span>
        ) : null}
        {presentation.summary.maximumHops !== undefined ? (
          <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.maximumHops} max hop(s)</span>
        ) : null}
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.statesCreated} traversal state(s)</span>
        {presentation.summary.hiddenPaths > 0 ? (
          <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent">{presentation.summary.hiddenPaths} hidden by panel limit</span>
        ) : null}
        <span className={`rounded-full px-3 py-1.5 ${presentation.status === "complete" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
          {presentation.status}
        </span>
      </div>

      {presentation.notices.length ? (
        <div className="mt-5 grid gap-2">
          {presentation.notices.map((notice) => (
            <p key={notice} className="rounded-xl border border-warning bg-warning-soft p-3 text-sm font-semibold text-warning">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={`${presentation.graphId}:${row.pathIndex}`} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase text-accent">
                Path {row.pathIndex + 1}
              </span>
              <span className="text-xs font-semibold text-muted">{row.hopCount} hop(s)</span>
            </div>

            <ol className="mt-4 grid gap-3">
              {row.nodes.map((node, nodeIndex) => (
                <li key={`${row.pathIndex}:${node.id}:${nodeIndex}`} className="rounded-xl border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] font-bold uppercase text-muted">{node.kind}</span>
                    <span className="break-all text-sm font-semibold text-ink">{node.label}</span>
                  </div>
                  {node.path ? <code className="mt-2 block break-all text-xs text-muted">{node.path}</code> : null}
                  {nodeIndex < row.hops.length ? (
                    <p className="mt-2 break-all text-xs text-accent">
                      ↓ {row.hops[nodeIndex].edgeKind} · {row.hops[nodeIndex].edgeId}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-accent bg-panel p-8 text-center text-sm text-muted">
            No path was returned within the current query bounds.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Graph {presentation.graphId} · schema {presentation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
