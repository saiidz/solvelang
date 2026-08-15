import { adminApi } from "@/lib/backend";
import { requireAdminSession, requireTrustedOrigin } from "@/lib/auth";

const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    await requireTrustedOrigin();
  } catch {
    return json({ error: "Administrative request denied." }, 403);
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  const state = typeof body.state === "string" ? body.state : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const terminationConfirmation = typeof body.terminationConfirmation === "string" ? body.terminationConfirmation : "";
  if (!ACCOUNT_ID.test(accountId) || !["suspended", "active", "terminated"].includes(state)) return json({ error: "Invalid account transition." }, 400);
  if (!reason || reason.length > 512 || !REQUEST_ID.test(requestId)) return json({ error: "Reason or request ID is invalid." }, 400);
  if (state === "terminated" && terminationConfirmation !== `TERMINATE ${accountId}`) {
    return json({ error: `Termination requires exact confirmation: TERMINATE ${accountId}` }, 400);
  }
  const upstream = await adminApi("/internal/accounts/access", {
    method: "POST",
    body: JSON.stringify({ accountId, state, reason, requestId }),
  });
  return json(upstream.body, upstream.status);
}
