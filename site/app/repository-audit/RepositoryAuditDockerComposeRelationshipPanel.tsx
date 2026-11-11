"use client";

import type {
  DockerComposeRelationshipPresentationRow,
  DockerComposeRelationshipSnapshotPresentation,
} from "./core/dockerComposeRelationshipSnapshotPresentation";

type RepositoryAuditDockerComposeRelationshipPanelProps = {
  presentation: DockerComposeRelationshipSnapshotPresentation;
  className?: string;
};

const targetStateClasses: Record<DockerComposeRelationshipPresentationRow["targetState"], string> = {
  present: "border-success bg-success-soft text-success",
  missing: "border-danger bg-danger-soft text-danger",
};

function syntaxLabel(syntax: DockerComposeRelationshipPresentationRow["syntax"]): string {
  return syntax === "inline-list" ? "inline list" : syntax;
}

export function RepositoryAuditDockerComposeRelationshipPanel({
  presentation,
  className = "",
}: RepositoryAuditDockerComposeRelationshipPanelProps) {
  return (
    <section className={`rounded-[2rem] border border-accent bg-accent-soft p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Docker Compose dependencies</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Static bounded service relationships</h2>
        </div>
        <p className="text-sm text-muted">
          {presentation.summary.rowsShown} shown · {presentation.summary.relationshipsSeen} relationships seen
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        SolveLang presents only explicit static <code>depends_on</code> references from bounded Docker Compose text. It does not evaluate interpolation, anchors, profiles, runtime readiness, health checks, container state, or network reachability.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.composeFiles} Compose files analyzed</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.servicesSeen} services seen</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.relationshipsReturnedByEvidence} relationships returned</span>
        {presentation.summary.missingTargets > 0 ? (
          <span className="rounded-full bg-danger-soft px-3 py-1.5 text-danger">{presentation.summary.missingTargets} missing targets</span>
        ) : null}
        {presentation.summary.unsupportedReferences > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">{presentation.summary.unsupportedReferences} unsupported references</span>
        ) : null}
        {presentation.summary.relationshipsHiddenByEvidenceBound > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1.5 text-warning">{presentation.summary.relationshipsHiddenByEvidenceBound} hidden by evidence bound</span>
        ) : null}
        {presentation.summary.rowsHiddenByPresentationBound > 0 ? (
          <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent">{presentation.summary.rowsHiddenByPresentationBound} hidden by row limit</span>
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
          <article key={`${row.composePath}:${row.fromService}:${row.toService}`} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${targetStateClasses[row.targetState]}`}>
                {row.targetState === "present" ? "declared target" : "missing target"}
              </span>
              <span className="rounded-full bg-panel-alt px-3 py-1 text-xs font-semibold text-body">
                {syntaxLabel(row.syntax)} syntax
              </span>
            </div>
            <code className="mt-4 block break-all text-xs font-semibold text-muted">{row.composePath}</code>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <code className="break-all rounded-xl bg-canvas p-3 text-sm font-semibold text-ink">{row.fromService}</code>
              <span className="text-muted" aria-hidden="true">→</span>
              <code className="break-all rounded-xl bg-canvas p-3 text-sm font-semibold text-ink">{row.toService}</code>
            </div>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-accent bg-panel p-8 text-center text-sm text-muted lg:col-span-2">
            No explicit bounded Docker Compose dependency relationships were identified.
          </div>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        Schema {presentation.schema} · {presentation.status} evidence · Compose evaluation disabled · container start disabled · network access disabled · write access disabled
      </p>
    </section>
  );
}
