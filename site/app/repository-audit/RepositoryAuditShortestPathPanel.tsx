"use client";

import type { SolveGraphShortestPathPresentation } from "../solve-graph/core/shortest-path-presentation";

type RepositoryAuditShortestPathPanelProps = {
  presentation: SolveGraphShortestPathPresentation;
  className?: string;
};

function directionLabel(direction: SolveGraphShortestPathPresentation["direction"]): string {
  return direction === "dependencies" ? "dependency path" : "dependent path";
}

export function RepositoryAuditShortestPathPanel({
  presentation,
  className = "",
}: RepositoryAuditShortestPathPanelProps) {
  return (
    <section
      aria-labelledby="repository-audit-shortest-path-heading"
      aria-live="polite"
      className={`rounded-[2rem] border border-indigo-200 bg-indigo-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-800">Solve Graph shortest path</p>
          <h2 id="repository-audit-shortest-path-heading" className="mt-2 text-2xl font-semibold text-ink">
            Bounded {directionLabel(presentation.direction)}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${presentation.status === "complete" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
          {presentation.status}
        </span>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        SolveLang shows only the deterministic shortest path returned by the bounded graph query. A complete no-path result is kept distinct from a partial search that reached a depth or visited-node bound.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.found ? "path found" : "no path returned"}</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.hopCount} hop(s)</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.visitedCount} visited node(s)</span>
        {presentation.execution.queryTruncated ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">query bound reached</span>
        ) : null}
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

      <div className="mt-6 grid gap-3">
        {presentation.nodes.length ? presentation.nodes.map((node, nodeIndex) => (
          <article key={`${presentation.graphId}:${node.id}:${nodeIndex}`} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold uppercase text-indigo-800">{node.kind}</span>
              <span className="break-all text-sm font-semibold text-ink">{node.label}</span>
            </div>
            {node.path ? <code className="mt-2 block break-all text-xs text-muted">{node.path}</code> : null}
            {nodeIndex < presentation.hops.length ? (
              <p className="mt-3 break-all text-xs font-semibold text-indigo-800">
                ↓ {presentation.hops[nodeIndex].edgeKind} · {presentation.hops[nodeIndex].edgeId}
              </p>
            ) : null}
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-indigo-200 bg-panel p-8 text-center text-sm text-muted">
            No path nodes are available for this result.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Graph {presentation.graphId} · schema {presentation.schema} · analyze only · network access disabled · write access disabled
      </p>
    </section>
  );
}
