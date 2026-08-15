import { headers } from "next/headers";
import { clearAdminSession, hasAdminSession, requireTrustedOrigin, setAdminSession, verifyAdminPassword } from "@/lib/auth";
import { canAttempt, clearFailures, loginSource, recordFailure } from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  return json({ authenticated: await hasAdminSession() });
}

export async function POST(request: Request) {
  try {
    await requireTrustedOrigin();
  } catch {
    return json({ error: "Sign-in denied." }, 403);
  }
  const incoming = await headers();
  const source = loginSource(incoming);
  if (!canAttempt(source)) return json({ error: "Sign-in denied." }, 429);
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Sign-in denied." }, 400); }
  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyAdminPassword(password)) {
    recordFailure(source);
    return json({ error: "Sign-in denied." }, 403);
  }
  clearFailures(source);
  await setAdminSession();
  return json({ authenticated: true });
}

export async function DELETE() {
  try {
    await requireTrustedOrigin();
  } catch {
    return json({ error: "Sign-out denied." }, 403);
  }
  await clearAdminSession();
  return json({ authenticated: false });
}
