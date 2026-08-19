"use client";

import { RepositoryAuditPackageScriptPathPanel } from "./RepositoryAuditPackageScriptPathPanel";
import type { RepositoryPackageScriptPathProductBundle } from "./core/packageScriptPathProduct";

type RepositoryAuditPackageScriptProductPanelProps = {
  bundle: RepositoryPackageScriptPathProductBundle;
  onDownload?: (download: RepositoryPackageScriptPathProductBundle["download"]) => void;
  className?: string;
};

export function RepositoryAuditPackageScriptProductPanel({
  bundle,
  onDownload,
  className = "",
}: RepositoryAuditPackageScriptProductPanelProps) {
  return (
    <div className={`grid gap-5 ${className}`.trim()}>
      <RepositoryAuditPackageScriptPathPanel presentation={bundle.presentation} />

      <section
        aria-labelledby="repository-audit-package-script-export-heading"
        className="rounded-[2rem] border border-blue-200 bg-blue-50 p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Package-script evidence export</p>
            <h2 id="repository-audit-package-script-export-heading" className="mt-2 text-2xl font-semibold text-slate-950">
              Integrity-covered static path evidence
            </h2>
          </div>
          <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${bundle.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
            {bundle.status}
          </span>
        </div>

        <p className="mt-3 max-w-4xl leading-7 text-slate-700">
          The downloadable JSON contains only bounded static package-script path evidence. Scripts and package managers are never executed to create this artifact.
        </p>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Artifact schema</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.download.artifact.schema}</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Graph</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-800">{bundle.graphId}</p>
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
            className="mt-5 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Download package-script evidence
          </button>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Analyze only · network access disabled · write access disabled
          {bundle.execution.presentationRowsTruncated ? " · presentation row limit reached" : ""}
        </p>
      </section>
    </div>
  );
}
