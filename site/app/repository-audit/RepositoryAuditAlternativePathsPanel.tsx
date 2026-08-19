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
    <section className={`rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-800">Solve Graph alternatives</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Bounded {directionLabel(presentation.direction)}</h2>
        </div>
        <p className="text-sm text-slate-600">
          {presentation.summary.shownPaths} shown · {presentation.summary.availablePaths} returned
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        SolveLang shows deterministic simple paths already returned by the bounded graph query. Query limits and presentation limits remain separate, so a partial result is never presented as complete coverage.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.availablePaths} path(s)</span>
        {presentation.summary.minimumHops !== undefined ? (
          <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.minimumHops} min hop(s)</span>
        ) : null}
        {presentation.summary.maximumHops !== undefined ? (
          <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.maximumHops} max hop(s)</span>
        ) : null}
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.statesCreated} traversal state(s)</span>
        {presentation.summary.hiddenPaths > 0 ? (
          <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-900">{presentation.summary.hiddenPaths} hidden by panel limit</span>
        ) : null}
        <span className={`rounded-full px-3 py-1.5 ${presentation.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {presentation.status}
        </span>
      </div>

      {presentation.notices.length ? (
        <div className="mt-5 grid gap-2">
          {presentation.notices.map((notice) => (
            <p key={notice} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={`${presentation.graphId}:${row.pathIndex}`} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold uppercase text-cyan-900">
                Path {row.pathIndex + 1}
              </span>
              <span className="text-xs font-semibold text-slate-500">{row.hopCount} hop(s)</span>
            </div>

            <ol className="mt-4 grid gap-3">
              {row.nodes.map((node, nodeIndex) => (
                <li key={`${row.pathIndex}:${node.id}:${nodeIndex}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase text-slate-600">{node.kind}</span>
                    <span className="break-all text-sm font-semibold text-slate-950">{node.label}</span>
                  </div>
                  {node.path ? <code className="mt-2 block break-all text-xs text-slate-500">{node.path}</code> : null}
                  {nodeIndex < row.hops.length ? (
                    <p className="mt-2 break-all text-xs text-cyan-800">
                      ↓ {row.hops[nodeIndex].edgeKind} · {row.hops[nodeIndex].edgeId}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-cyan-200 bg-white p-8 text-center text-sm text-slate-500">
            No path was returned within the current query bounds.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Graph {presentation.graphId} · schema {presentation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
