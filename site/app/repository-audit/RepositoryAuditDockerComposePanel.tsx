"use client";

import type {
  DockerComposeSnapshotPresentation,
  DockerComposeSnapshotPresentationRow,
} from "./core/dockerComposeSnapshotPresentation";

type RepositoryAuditDockerComposePanelProps = {
  presentation: DockerComposeSnapshotPresentation;
  className?: string;
};

const imageStateClasses: Record<DockerComposeSnapshotPresentationRow["imageState"], string> = {
  declared: "border-emerald-200 bg-emerald-50 text-emerald-800",
  unresolved: "border-amber-200 bg-amber-50 text-amber-800",
};

export function RepositoryAuditDockerComposePanel({
  presentation,
  className = "",
}: RepositoryAuditDockerComposePanelProps) {
  return (
    <section className={`rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-800">Docker Compose evidence</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Static bounded service and image declarations</h2>
        </div>
        <p className="text-sm text-slate-600">
          {presentation.summary.rowsShown} shown · {presentation.summary.services} services analyzed
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        SolveLang presents only Docker Compose service and literal image evidence already supplied by the bounded repository snapshot. Environment substitution, YAML-anchor evaluation, image resolution, pulls, builds, and container starts are not performed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.composeFiles} Compose files analyzed</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.declaredImages} declared images</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.unresolvedImages} unresolved images</span>
        {presentation.summary.composeFilesSkipped > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{presentation.summary.composeFilesSkipped} files skipped</span>
        ) : null}
        {presentation.summary.composeFilesOmittedByFileBound > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{presentation.summary.composeFilesOmittedByFileBound} files hidden by scan bound</span>
        ) : null}
        {presentation.summary.rowsHidden > 0 ? (
          <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-900">{presentation.summary.rowsHidden} services hidden by row limit</span>
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

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={`${row.composePath}:${row.serviceName}`} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${imageStateClasses[row.imageState]}`}>
                {row.imageState === "declared" ? "literal image" : "unresolved image"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                service
              </span>
            </div>
            <code className="mt-4 block break-all text-xs font-semibold text-slate-500">{row.composePath}</code>
            <h3 className="mt-2 break-all text-base font-semibold text-slate-950">{row.serviceName}</h3>
            {row.image ? (
              <code className="mt-3 block break-all rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-800">{row.image}</code>
            ) : (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Image value is dynamic or otherwise unresolved; no value was guessed.</p>
            )}
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-cyan-200 bg-white p-8 text-center text-sm text-slate-500 lg:col-span-2">
            No bounded Docker Compose service evidence was identified.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Schema {presentation.schema} · {presentation.status} evidence · image resolution disabled · container build/start disabled · network access disabled · write access disabled
      </p>
    </section>
  );
}
