"use client";

import type { SolveGraphShortestPathProductBundle } from "../solve-graph/core/shortest-path-product";

type RepositoryAuditShortestPathProductPanelProps = {
  bundle: SolveGraphShortestPathProductBundle;
  onDownload?: (download: SolveGraphShortestPathProductBundle["download"]) => void;
  className?: string;
};

export function RepositoryAuditShortestPathProductPanel({
  bundle,
  onDownload,
  className = "",
}: RepositoryAuditShortestPathProductPanelProps) {
  return (
    <section
      aria-labelledby="repository-audit-shortest-path-export-heading"
      className={`rounded-[2rem] border border-indigo-200 bg-indigo-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-800">Shortest-path evidence export</p>
          <h2 id="repository-audit-shortest-path-export-heading" className="mt-2 text-2xl font-semibold text-slate-950">
            Integrity-covered bounded path
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${bundle.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {bundle.status}
        </span>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        This export contains only the validated bounded shortest-path result and traversal metadata. A complete no-path result remains distinct from a partial search that reached a query bound.
      </p>

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Artifact schema</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.download.artifact.schema}</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Graph</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.graphId}</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.sourceId}</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.targetId}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{bundle.found ? "path found" : "no path returned"}</span>
        <span className="rounded-full bg-white px-3 py-1.5">{bundle.presentation.summary.hopCount} hop(s)</span>
        <span className="rounded-full bg-white px-3 py-1.5">{bundle.presentation.summary.visitedCount} visited node(s)</span>
        {bundle.execution.queryTruncated ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">query bound reached</span>
        ) : null}
      </div>

      <p className="mt-4 break-all font-mono text-xs leading-5 text-slate-600">
        SHA-256: {bundle.download.artifact.integrity.canonicalJsonSha256}
      </p>
      <p className="mt-2 break-all text-xs leading-5 text-slate-500">
        File: {bundle.download.filename}
      </p>

      {onDownload ? (
        <button
          type="button"
          onClick={() => onDownload(bundle.download)}
          className="mt-5 rounded-xl bg-indigo-800 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-900"
        >
          Download shortest-path evidence
        </button>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Analyze only · network access disabled · write access disabled
      </p>
    </section>
  );
}
