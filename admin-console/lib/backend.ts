function required(name: string, minimum = 1) {
  const value = process.env[name];
  if (!value || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

function apiBase() {
  const value = required("SOLVELANG_ADMIN_API_BASE").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("SOLVELANG_ADMIN_API_BASE must use HTTPS outside local development.");
  }
  return url.toString().replace(/\/$/, "");
}

function adminSecret() {
  return required("SOLVELANG_ADMIN_API_SECRET", 32);
}

export async function adminApi(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/")) throw new Error("Admin API path must be absolute.");
  const headers = new Headers(init.headers);
  headers.set("x-solvelang-admin-secret", adminSecret());
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "Administrative API returned an invalid response.", code: "invalid_upstream_response" };
  }
  return { status: response.status, body };
}

export function identityQuery(type: string, value: string) {
  if (!["accountId", "email", "username"].includes(type)) throw new Error("Identity type is invalid.");
  const params = new URLSearchParams({ [type]: value });
  return params.toString();
}
