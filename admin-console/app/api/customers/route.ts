import { adminApi, identityQuery } from "@/lib/backend";
import { requireAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try { await requireAdminSession(); } catch { return json({ error: "Administrative session required." }, 401); }
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const value = url.searchParams.get("value")?.trim();
  let path = "/internal/admin/customers";
  try {
    if (type && value) path += `?${identityQuery(type, value)}`;
    else {
      const params = new URLSearchParams();
      const cursor = url.searchParams.get("cursor");
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");
      path += `?${params.toString()}`;
    }
  } catch {
    return json({ error: "Customer identity is invalid." }, 400);
  }
  const upstream = await adminApi(path);
  return json(upstream.body, upstream.status);
}
