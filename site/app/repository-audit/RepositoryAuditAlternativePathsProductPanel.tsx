"use client";

import { RepositoryAuditAlternativePathsExplanationPanel } from "./RepositoryAuditAlternativePathsExplanationPanel";
import { RepositoryAuditAlternativePathsPanel } from "./RepositoryAuditAlternativePathsPanel";
import type { SolveGraphAlternativePathsProductBundle } from "../solve-graph/core/alternative-paths-product";

type RepositoryAuditAlternativePathsProductPanelProps = {
  bundle: SolveGraphAlternativePathsProductBundle;
  onDownload?: (download: SolveGraphAlternativePathsProductBundle["download"]) => void;
  className?: string;
};

export function RepositoryAuditAlternativePathsProductPanel({
  bundle,
  onDownload,
  className = "",
}: RepositoryAuditAlternativePathsProductPanelProps) {
  return (
    <div className={`grid gap-5 ${className}`.trim()}>
      <RepositoryAuditAlternativePathsPanel presentation={bundle.presentation} />
      <RepositoryAuditAlternativePathsExplanationPanel bundle={bundle} />

      <section
        aria-labelledby="repository-audit-alternative-path-export-heading"
        className="rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-800">Alternative-path evidence export</p>
            <h2 id="repository-audit-alternative-path-export-heading" className="mt-2 text-2xl font-semibold text-slate-950">
              Integrity-covered bounded paths
            </h2>
          </div>
          <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${bundle.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
            {bundle.status}
          </span>
        </div>

        <p className="mt-3 max-w-4xl leading-7 text-slate-700">
          The downloadable JSON preserves only the validated bounded path result and traversal metadata. Query truncation and presentation row limits remain separate so partial coverage is never presented as complete.
        </p>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-cyan-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Artifact schema</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.download.artifact.schema}</p>
          </div>
          <div className="rounded-2xl border border-cyan-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Graph</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.graphId}</p>
          </div>
          <div className="rounded-2xl border border-cyan-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.sourceId}</p>
          </div>
          <div className="rounded-2xl border border-cyan-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.targetId}</p>
          </div>
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
            className="mt-5 rounded-xl bg-cyan-800 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-900"
          >
            Download alternative-path evidence
          </button>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Analyze only · network access disabled · write access disabled
          {bundle.execution.queryTruncated ? " · query bounds reached" : ""}
          {bundle.execution.presentationRowsTruncated ? " · presentation row limit reached" : ""}
        </p>
      </section>
    </div>
  );
}
