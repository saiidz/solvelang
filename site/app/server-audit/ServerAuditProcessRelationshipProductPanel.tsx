"use client";

import { ServerAuditProcessRelationshipPanel } from "./ServerAuditProcessRelationshipPanel";
import type { ServerAuditProcessRelationshipProductBundle } from "./core/processRelationshipProduct";

type ServerAuditProcessRelationshipProductPanelProps = {
  bundle: ServerAuditProcessRelationshipProductBundle;
  onDownload?: (download: ServerAuditProcessRelationshipProductBundle["download"]) => void;
  className?: string;
};

export function ServerAuditProcessRelationshipProductPanel({
  bundle,
  onDownload,
  className = "",
}: ServerAuditProcessRelationshipProductPanelProps) {
  return (
    <div className={`grid gap-5 ${className}`.trim()}>
      <ServerAuditProcessRelationshipPanel presentation={bundle.presentation} />

      <section
        aria-labelledby="server-audit-process-relationship-export-heading"
        className="rounded-[2rem] border border-accent bg-accent-soft p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Process relationship export</p>
            <h2 id="server-audit-process-relationship-export-heading" className="mt-2 text-2xl font-semibold text-ink">
              Integrity-covered structural evidence
            </h2>
          </div>
          <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase ${bundle.status === "complete" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {bundle.status}
          </span>
        </div>

        <p className="mt-3 max-w-4xl leading-7 text-body">
          The downloadable JSON contains only bounded structural process and listening-socket references. Raw process names, command lines, socket labels, and credential values are not added by this surface.
        </p>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl border border-accent bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Artifact schema</p>
            <p className="mt-2 break-all font-mono text-xs text-body">{bundle.download.artifact.schema}</p>
          </div>
          <div className="rounded-2xl border border-accent bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Processes checked</p>
            <p className="mt-2 text-lg font-semibold text-ink">{bundle.download.artifact.summary.processesChecked}</p>
          </div>
          <div className="rounded-2xl border border-accent bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Listeners checked</p>
            <p className="mt-2 text-lg font-semibold text-ink">{bundle.download.artifact.summary.listenersChecked}</p>
          </div>
        </div>

        <p className="mt-4 break-all font-mono text-xs leading-5 text-muted">
          SHA-256: {bundle.download.artifact.integrity.canonicalJsonSha256}
        </p>
        <p className="mt-2 break-all text-xs leading-5 text-muted">
          File: {bundle.download.filename}
        </p>

        {onDownload ? (
          <button
            type="button"
            onClick={() => onDownload(bundle.download)}
            className="mt-5 rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-solid"
          >
            Download process relationship evidence
          </button>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-muted">
          Analyze only · network access disabled · write access disabled
          {bundle.execution.sourcePartial ? " · source evidence partial" : ""}
          {bundle.execution.presentationRowsTruncated ? " · presentation row limit reached" : ""}
        </p>
      </section>
    </div>
  );
}
