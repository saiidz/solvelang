"use client";

import type {
  RepositoryFrameworkPathPresentation,
  RepositoryFrameworkPathPresentationRow,
} from "./core/frameworkPathPresentation";

type RepositoryAuditFrameworkPathPanelProps = {
  presentation: RepositoryFrameworkPathPresentation;
  className?: string;
};

const targetStateClasses: Record<RepositoryFrameworkPathPresentationRow["targetState"], string> = {
  present: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "outside-bounded-scan": "border-amber-200 bg-amber-50 text-amber-800",
  missing: "border-rose-200 bg-rose-50 text-rose-800",
};

function targetStateLabel(state: RepositoryFrameworkPathPresentationRow["targetState"]): string {
  if (state === "outside-bounded-scan") return "outside bounded scan";
  return state;
}

export function RepositoryAuditFrameworkPathPanel({
  presentation,
  className = "",
}: RepositoryAuditFrameworkPathPanelProps) {
  const skipped = presentation.summary.skippedMissingText
    + presentation.summary.skippedOversizedText
    + presentation.summary.skippedInvalidJson
    + presentation.summary.skippedDynamicReferences;

  return (
    <section className={`rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-800">Framework path evidence</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Explicit Angular and Nest repository paths</h2>
        </div>
        <p className="text-sm text-slate-600">
          {presentation.summary.rowsShown} shown · {presentation.summary.relationships} analyzed
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        SolveLang maps only explicit static repository-local paths from bounded Angular and Nest configuration evidence. Dynamic, absolute, globbed, malformed, or otherwise ambiguous references are skipped instead of guessed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.angularRelationships} Angular</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.nestRelationships} Nest</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.presentTargets} present</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.outsideBoundedScanTargets} outside bounded scan</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.missingTargets} missing</span>
        <span className="rounded-full bg-white px-3 py-1.5">{skipped} skipped evidence item(s)</span>
        {presentation.summary.rowsHidden > 0 ? (
          <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-900">{presentation.summary.rowsHidden} hidden by row limit</span>
        ) : null}
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

      <div className="mt-6 grid gap-3">
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={row.evidenceId} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold uppercase text-cyan-900">
                {row.framework}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-700">
                {row.kind.replaceAll("-", " ")}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${targetStateClasses[row.targetState]}`}>
                {targetStateLabel(row.targetState)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {row.targetType}
              </span>
            </div>
            <code className="mt-4 block break-all text-sm font-semibold text-slate-950">{row.fromPath}</code>
            <p className="my-1 text-xs text-slate-400">→</p>
            <code className="block break-all text-sm font-semibold text-slate-950">{row.targetPath}</code>
            <p className="mt-3 break-all text-xs leading-5 text-slate-500">
              Evidence: {row.evidence.path} · {row.evidence.field}
            </p>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-cyan-200 bg-white p-8 text-center text-sm text-slate-500">
            No explicit bounded framework-path relationships were identified.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Graph {presentation.graphId} · schema {presentation.schema} · {presentation.status} evidence · network access disabled · write access disabled
      </p>
    </section>
  );
}
