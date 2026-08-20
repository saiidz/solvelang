"use client";

import { createSolveGraphShortestPathExplanation } from "../solve-graph/core/shortest-path-explanation";
import type { SolveGraphShortestPathProductBundle } from "../solve-graph/core/shortest-path-product";

type RepositoryAuditShortestPathExplanationPanelProps = {
  bundle: SolveGraphShortestPathProductBundle;
  className?: string;
};

export function RepositoryAuditShortestPathExplanationPanel({
  bundle,
  className = "",
}: RepositoryAuditShortestPathExplanationPanelProps) {
  const explanation = createSolveGraphShortestPathExplanation(bundle);

  return (
    <section
      aria-labelledby="repository-audit-shortest-path-explanation-heading"
      className={`rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">Path explanation</p>
          <h2 id="repository-audit-shortest-path-explanation-heading" className="mt-2 text-2xl font-semibold text-slate-950">
            {explanation.headline}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${explanation.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {explanation.status}
        </span>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">{explanation.detail}</p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{explanation.summary.hopCount} hop(s)</span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{explanation.summary.visitedCount} visited node(s)</span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{explanation.direction}</span>
        {explanation.execution.queryTruncated ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">bounded search incomplete</span>
        ) : null}
      </div>

      {explanation.steps.length ? (
        <ol className="mt-6 grid gap-3">
          {explanation.steps.map((step) => (
            <li key={`${explanation.graphId}:${step.edgeId}:${step.index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="rounded-full bg-white px-2.5 py-1">Step {step.index}</span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800">{step.edgeKind}</span>
              </div>
              <p className="mt-3 break-all font-mono text-sm text-slate-900">{step.sentence}</p>
              <p className="mt-2 break-all text-xs text-slate-500">
                {step.from.kind} {step.from.id} → {step.to.kind} {step.to.id}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          No traversal steps are available for this result.
        </div>
      )}

      {explanation.notices.length ? (
        <div className="mt-5 grid gap-2">
          {explanation.notices.map((notice) => (
            <p key={notice} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Analyze only · explanation schema {explanation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
