import { adminApi } from "@/lib/backend";
import { requireAdminSession, requireTrustedOrigin } from "@/lib/auth";

const ACTIONS: Record<string, { path: string; field: string }> = {
  profile: { path: "/internal/admin/customers/profile", field: "profile" },
  note: { path: "/internal/admin/customers/notes", field: "note" },
  task: { path: "/internal/admin/customers/tasks", field: "task" },
  taskUpdate: { path: "/internal/admin/customers/tasks/update", field: "task" },
};

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
  let body: { action?: unknown; identity?: unknown; payload?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = typeof body.action === "string" ? ACTIONS[body.action] : undefined;
  if (!action || !body.identity || typeof body.identity !== "object") return json({ error: "Invalid CRM action." }, 400);
  const upstream = await adminApi(action.path, {
    method: "POST",
    body: JSON.stringify({ identity: body.identity, [action.field]: body.payload ?? {} }),
  });
  return json(upstream.body, upstream.status);
}
