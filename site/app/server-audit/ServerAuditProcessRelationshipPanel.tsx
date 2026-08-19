"use client";

import type {
  ServerAuditProcessRelationshipPresentation,
  ServerAuditProcessRelationshipPresentationRow,
} from "./core/processRelationshipPresentation";

type ServerAuditProcessRelationshipPanelProps = {
  presentation: ServerAuditProcessRelationshipPresentation;
  className?: string;
};

const kindLabels: Record<ServerAuditProcessRelationshipPresentationRow["kind"], string> = {
  "parent-process": "parent process",
  "listener-process": "listener process",
  "ambiguous-listener-process": "ambiguous listener",
};

const kindClasses: Record<ServerAuditProcessRelationshipPresentationRow["kind"], string> = {
  "parent-process": "border-blue-200 bg-blue-50 text-blue-800",
  "listener-process": "border-emerald-200 bg-emerald-50 text-emerald-800",
  "ambiguous-listener-process": "border-amber-200 bg-amber-50 text-amber-900",
};

export function ServerAuditProcessRelationshipPanel({
  presentation,
  className = "",
}: ServerAuditProcessRelationshipPanelProps) {
  return (
    <section
      aria-labelledby="server-audit-process-relationships-heading"
      aria-live="polite"
      className={`rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Process relationships</p>
          <h2 id="server-audit-process-relationships-heading" className="mt-2 text-2xl font-semibold text-slate-950">Bounded structural attribution</h2>
        </div>
        <p className="text-sm text-slate-600">
          {presentation.summary.shownRows} shown · {presentation.summary.relationships} analyzed
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        SolveLang presents only sanitized snapshot references such as process and listening-socket indexes. Raw process names, command lines, and socket labels are not rendered by this surface.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{presentation.summary.parentRelationships} parent relationships</span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{presentation.summary.listenerRelationships} listener relationships</span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{presentation.summary.ambiguousListenerRelationships} ambiguous</span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5">{presentation.summary.unresolvedListenerAttributions} unresolved</span>
        {presentation.summary.hiddenRows > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{presentation.summary.hiddenRows} hidden by row limit</span>
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
          <article key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${kindClasses[row.kind]}`}>
                {kindLabels[row.kind]}
              </span>
              {row.sourcesTruncated ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">source fanout truncated</span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2">
              {row.sources.map((source, index) => (
                <div key={`${row.id}-${source}`} className="flex items-start gap-3">
                  <span className="mt-0.5 text-xs font-bold text-slate-400">{index + 1}</span>
                  <code className="break-all text-sm font-semibold text-slate-900">{source}</code>
                </div>
              ))}
            </div>
            <p className="mt-4 break-all font-mono text-xs text-slate-500">{row.id}</p>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            No bounded process relationships were identified in the supplied snapshot.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Schema {presentation.schema} · {presentation.status} evidence · network access disabled · write access disabled
      </p>
    </section>
  );
}
