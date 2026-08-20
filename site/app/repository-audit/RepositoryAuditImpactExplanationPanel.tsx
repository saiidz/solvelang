"use client";

import {
  createSolveGraphImpactExplanation,
  type SolveGraphImpactExplanationOptions,
} from "../solve-graph/core/impact-explanation";
import type {
  SolveGraphQueryIndex,
  SolveGraphTraversalResult,
} from "../solve-graph/core/query-impact";

type RepositoryAuditImpactExplanationPanelProps = {
  index: SolveGraphQueryIndex;
  result: SolveGraphTraversalResult;
  options?: SolveGraphImpactExplanationOptions;
  className?: string;
};

export function RepositoryAuditImpactExplanationPanel({
  index,
  result,
  options,
  className = "",
}: RepositoryAuditImpactExplanationPanelProps) {
  const explanation = createSolveGraphImpactExplanation(index, result, options);

  return (
    <section
      aria-labelledby="repository-audit-impact-explanation-heading"
      className={`rounded-[2rem] border border-violet-200 bg-violet-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-800">Impact explanation</p>
          <h2 id="repository-audit-impact-explanation-heading" className="mt-2 text-2xl font-semibold text-slate-950">
            {explanation.headline}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${explanation.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {explanation.status}
        </span>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">{explanation.detail}</p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{explanation.summary.rootCount} changed root(s)</span>
        <span className="rounded-full bg-white px-3 py-1.5">{explanation.summary.impactedNodes} impacted node(s)</span>
        <span className="rounded-full bg-white px-3 py-1.5">{explanation.summary.explainedNodes} explained node(s)</span>
        <span className="rounded-full bg-white px-3 py-1.5">depth {explanation.summary.maximumObservedDepth}</span>
        {explanation.summary.hiddenNodes > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{explanation.summary.hiddenNodes} hidden by presentation bound</span>
        ) : null}
        {explanation.execution.queryTruncated ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">impact query bound reached</span>
        ) : null}
      </div>

      {explanation.roots.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {explanation.roots.map((root) => (
            <code key={root.id} className="max-w-full break-all rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800">
              {root.kind} · {root.label}
            </code>
          ))}
        </div>
      ) : null}

      {explanation.rows.length ? (
        <div className="mt-6 grid gap-4">
          {explanation.rows.map((row) => (
            <article key={`${explanation.graphId}:${row.root.id}:${row.node.id}`} className="rounded-2xl border border-violet-100 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold uppercase text-violet-900">depth {row.depth}</span>
                <span className="text-xs font-semibold text-slate-500">{row.steps.length} relationship step(s)</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-950">{row.sentence}</p>
              <code className="mt-3 block break-all text-xs text-slate-600">
                {row.path.map((node) => `${node.kind}:${node.label}`).join(" → ")}
              </code>

              {row.steps.length ? (
                <ol className="mt-4 grid gap-2">
                  {row.steps.map((step) => (
                    <li key={`${row.node.id}:${step.edgeId}:${step.depth}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                        <span>Depth {step.depth}</span>
                        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800">{step.edgeKind}</span>
                      </div>
                      <p className="mt-2 break-all font-mono text-sm text-slate-900">{step.sentence}</p>
                      <p className="mt-2 break-all text-xs text-slate-500">
                        dependent {step.dependent.kind}:{step.dependent.id} → dependency {step.dependency.kind}:{step.dependency.id}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-violet-200 bg-white p-6 text-sm text-slate-600">
          No impacted dependent rows are available for this bounded result.
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
        Analyze only · explanation schema {explanation.schema} · graph {explanation.graphId} · network access disabled · write access disabled
      </p>
    </section>
  );
}
