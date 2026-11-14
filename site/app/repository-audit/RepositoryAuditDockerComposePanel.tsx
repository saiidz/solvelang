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
  declared: "border-success bg-success-soft text-success",
  unresolved: "border-warning bg-warning-soft text-warning",
};

export function RepositoryAuditDockerComposePanel({
  presentation,
  className = "",
}: RepositoryAuditDockerComposePanelProps) {
  return (
    <section className={`rounded-[2rem] border border-accent bg-accent-soft p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Docker Compose evidence</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Static bounded service and image declarations</h2>
        </div>
        <p className="text-sm text-muted">
          {presentation.summary.rowsShown} shown · {presentation.summary.services} services analyzed
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        SolveLang presents only Docker Compose service and literal image evidence already supplied by the bounded repository snapshot. Environment substitution, YAML-anchor evaluation, image resolution, pulls, builds, and container starts are not performed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.composeFiles} Compose files analyzed</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.declaredImages} declared images</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.unresolvedImages} unresolved images</span>
        {presentation.summary.composeFilesSkipped > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">{presentation.summary.composeFilesSkipped} files skipped</span>
        ) : null}
        {presentation.summary.composeFilesOmittedByFileBound > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">{presentation.summary.composeFilesOmittedByFileBound} files hidden by scan bound</span>
        ) : null}
        {presentation.summary.rowsHidden > 0 ? (
          <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent">{presentation.summary.rowsHidden} services hidden by row limit</span>
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

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {presentation.rows.length ? presentation.rows.map((row) => (
          <article key={`${row.composePath}:${row.serviceName}`} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${imageStateClasses[row.imageState]}`}>
                {row.imageState === "declared" ? "literal image" : "unresolved image"}
              </span>
              <span className="rounded-full bg-panel-alt px-3 py-1 text-xs font-semibold text-body">
                service
              </span>
            </div>
            <code className="mt-4 block break-all text-xs font-semibold text-muted">{row.composePath}</code>
            <h3 className="mt-2 break-all text-base font-semibold text-ink">{row.serviceName}</h3>
            {row.image ? (
              <code className="mt-3 block break-all rounded-xl bg-canvas p-3 text-sm font-semibold text-body">{row.image}</code>
            ) : (
              <p className="mt-3 rounded-xl bg-warning-soft p-3 text-sm text-warning">Image value is dynamic or otherwise unresolved; no value was guessed.</p>
            )}
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-accent bg-panel p-8 text-center text-sm text-muted lg:col-span-2">
            No bounded Docker Compose service evidence was identified.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Schema {presentation.schema} · {presentation.status} evidence · image resolution disabled · container build/start disabled · network access disabled · write access disabled
      </p>
    </section>
  );
}
