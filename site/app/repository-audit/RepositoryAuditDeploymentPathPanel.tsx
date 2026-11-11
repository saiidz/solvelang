"use client";

import type {
  RepositoryDeploymentPathPresentation,
  RepositoryDeploymentPathPresentationRow,
} from "./core/deploymentPathPresentation";

type RepositoryAuditDeploymentPathPanelProps = {
  presentation: RepositoryDeploymentPathPresentation;
  className?: string;
};

const targetStateClasses: Record<RepositoryDeploymentPathPresentationRow["targetState"], string> = {
  present: "border-success bg-success-soft text-success",
  "outside-bounded-scan": "border-warning bg-warning-soft text-warning",
  missing: "border-danger bg-danger-soft text-danger",
};

function evidenceLocation(row: RepositoryDeploymentPathPresentationRow): string {
  const line = row.evidence.line === undefined ? "" : `:${row.evidence.line}`;
  const field = row.evidence.field === undefined ? "" : ` · ${row.evidence.field}`;
  return `${row.evidence.path}${line}${field}`;
}

function targetStateLabel(state: RepositoryDeploymentPathPresentationRow["targetState"]): string {
  if (state === "outside-bounded-scan") return "outside bounded scan";
  return state;
}

export function RepositoryAuditDeploymentPathPanel({
  presentation,
  className = "",
}: RepositoryAuditDeploymentPathPanelProps) {
  return (
    <section className={`rounded-[2rem] border border-indigo-200 bg-indigo-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-800">Deployment path evidence</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Explicit repository-local deployment references</h2>
        </div>
        <p className="text-sm text-muted">
          {presentation.summary.rowsShown} shown · {presentation.summary.relationships} analyzed
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        SolveLang maps only explicit static repository-local deployment references that were already accepted by the bounded scan. Dynamic, remote, globbed, cross-stage, or otherwise ambiguous references are skipped instead of guessed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.presentTargets} present</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.outsideBoundedScanTargets} outside bounded scan</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.missingTargets} missing</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.skippedDynamicReferences} dynamic/ambiguous skipped</span>
        {presentation.summary.rowsHidden > 0 ? (
          <span className="rounded-full bg-indigo-100 px-3 py-1.5 text-indigo-900">{presentation.summary.rowsHidden} hidden by row limit</span>
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
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={row.evidenceId} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold uppercase text-indigo-900">
                {row.kind.replaceAll("-", " ")}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${targetStateClasses[row.targetState]}`}>
                {targetStateLabel(row.targetState)}
              </span>
              <span className="rounded-full bg-panel-alt px-3 py-1 text-xs font-semibold text-body">
                {row.targetType.replaceAll("-", " ")}
              </span>
            </div>
            <code className="mt-4 block break-all text-sm font-semibold text-ink">{row.fromPath}</code>
            <p className="my-1 text-xs text-muted">→</p>
            <code className="block break-all text-sm font-semibold text-ink">{row.targetPath}</code>
            <p className="mt-3 break-all text-xs leading-5 text-muted">Evidence: {evidenceLocation(row)}</p>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-indigo-200 bg-panel p-8 text-center text-sm text-muted">
            No explicit bounded deployment-path relationships were identified.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Graph {presentation.graphId} · schema {presentation.schema} · {presentation.status} evidence · network access disabled · write access disabled
      </p>
    </section>
  );
}
