// Governance audit client for recipe runs — Stage 0.
//
// Every recipe run appends ONE platform decision to the governance
// audit log through MGOV's recipes audit route (POST /recipes/audit,
// added in saiidz/solvelang-merge-governance alongside this stack) —
// the same external-write pattern as the verification service's
// /verification/audit: admin-token gated, every field validated
// server-side, and the stored decision reason built server-side from
// validated fields, never from caller free text.
//
// Fail-closed like the verification client: with no admin token the
// client reports {ok:false, unconfigured:true} and the run record
// keeps auditOk:false — visible, never silently swallowed.

export function buildRecipeAuditBody(record) {
  return {
    repo: record.repo,
    recipeId: record.recipeId,
    trigger: record.trigger,
    conclusion: record.conclusion,
    grading: record.grading ?? undefined,
    runId: record.id ?? undefined,
    baseSha: record.baseSha ?? undefined,
    installationId: record.installationId ?? undefined,
    durationMs: record.metering?.durationMs ?? undefined,
  };
}

export function createRecipesAuditClient({
  mgovBase,
  adminToken,
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  const base = typeof mgovBase === "string" ? mgovBase.replace(/\/$/, "") : "";
  return async function postRecipeAudit(record) {
    if (!adminToken || !base) {
      log("recipes_audit_unconfigured", record?.id ?? "unknown");
      return { ok: false, unconfigured: true };
    }
    try {
      const response = await fetchImpl(`${base}/recipes/audit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
          "user-agent": "solvelang-recipes",
        },
        body: JSON.stringify(buildRecipeAuditBody(record)),
      });
      if (!response.ok) {
        log("recipes_audit_failed", `status=${response.status}`);
        return { ok: false };
      }
      const payload = await response.json().catch(() => null);
      return { ok: true, decision: payload?.decision ?? null };
    } catch {
      log("recipes_audit_failed", "status=0");
      return { ok: false };
    }
  };
}
