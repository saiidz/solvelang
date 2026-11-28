// Fix-dispatch client for recipe fix runs — Recipes Stage 1 follow-up.
//
// In dispatch mode (RECIPES_FIX_VIA_MGOV=1 in the wiring) a recipe
// executor does NOT open its fix PR itself under an injected user
// token. Instead it submits the computed changes to MGOV's governed
// fix-dispatch route (POST /recipes/fix-dispatch in
// saiidz/solvelang-merge-governance), and MGOV opens the PR as
// solvelang-process-solution[bot] through its governed batch path —
// the identity the registry records for these recipes
// (process-solution-app). The author login MGOV returns is the one
// the receipt finding states; nothing is assumed locally.
//
// Contract (identical on both sides, do not vary):
//   Request JSON: { recipeId, runId, tenantId?, repo, baseBranch,
//     baseSha, branchName, title, body,
//     changes: [{ path, contentBase64 }] }
//   Success 201: { prNumber, prUrl,
//     authorLogin: "solvelang-process-solution[bot]", headBranch,
//     plan: { batchId, status } }
//   Errors: non-2xx with { error: "<code>" }.
//
// Fail-closed like the audit client (src/audit.js): admin-token auth
// identical to the /recipes/audit client, no token / no base reports
// { ok:false, unconfigured:true }, tokens are never logged, and error
// bodies are reduced to their error code only — never propagated raw.

export function fixViaMgovEnabled(env = process.env) {
  return env?.RECIPES_FIX_VIA_MGOV === "1";
}

export function buildFixDispatchBody(request) {
  return {
    recipeId: request.recipeId,
    runId: request.runId,
    ...(request.tenantId ? { tenantId: request.tenantId } : {}),
    repo: request.repo,
    baseBranch: request.baseBranch,
    baseSha: request.baseSha,
    branchName: request.branchName,
    title: request.title,
    body: request.body,
    changes: (request.changes ?? []).map((change) => ({
      path: change.path,
      contentBase64: change.contentBase64,
    })),
  };
}

export function createFixDispatchClient({
  mgovBase,
  adminToken,
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  const base = typeof mgovBase === "string" ? mgovBase.replace(/\/$/, "") : "";
  return async function dispatchFix(request) {
    if (!adminToken || !base) {
      log("recipes_fix_dispatch_unconfigured", request?.runId ?? "unknown");
      return { ok: false, unconfigured: true, error: "fix_dispatch_unconfigured" };
    }
    let response;
    try {
      response = await fetchImpl(`${base}/recipes/fix-dispatch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
          "user-agent": "solvelang-recipes",
        },
        body: JSON.stringify(buildFixDispatchBody(request)),
      });
    } catch {
      log("recipes_fix_dispatch_failed", "status=0");
      return { ok: false, error: "fix_dispatch_request_failed", status: 0 };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        typeof payload?.error === "string" && payload.error ? payload.error : "fix_dispatch_failed";
      log("recipes_fix_dispatch_failed", `status=${response.status} error=${code}`);
      return { ok: false, error: code, status: response.status };
    }
    return {
      ok: true,
      prNumber: payload?.prNumber ?? null,
      prUrl: payload?.prUrl ?? null,
      authorLogin: payload?.authorLogin ?? null,
      headBranch: payload?.headBranch ?? null,
      plan: payload?.plan ?? null,
    };
  };
}
