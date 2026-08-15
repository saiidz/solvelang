import { cookies, headers } from "next/headers";
import { createSessionToken, originAllowed, verifyScryptPassword, verifySessionToken } from "./auth-core";

const COOKIE_NAME = "sl_admin_session";

function required(name: string, minimum = 1) {
  const value = process.env[name];
  if (!value || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

export function adminConsoleOrigin() {
  return required("SOLVELANG_ADMIN_CONSOLE_ORIGIN");
}

function sessionSecret() {
  return required("SOLVELANG_ADMIN_SESSION_SECRET", 32);
}

function passwordHash() {
  return required("SOLVELANG_ADMIN_PASSWORD_SCRYPT");
}

export async function hasAdminSession() {
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE_NAME)?.value, sessionSecret()) !== null;
}

export async function requireAdminSession() {
  if (!(await hasAdminSession())) throw new Error("admin_session_required");
}

export async function requireTrustedOrigin() {
  const incoming = await headers();
  if (!originAllowed(incoming.get("origin"), adminConsoleOrigin())) throw new Error("admin_origin_denied");
}

export function verifyAdminPassword(password: string) {
  return verifyScryptPassword(password, passwordHash());
}

export async function setAdminSession() {
  const jar = await cookies();
  const secure = adminConsoleOrigin().startsWith("https://");
  jar.set(COOKIE_NAME, createSessionToken(sessionSecret()), {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

export async function clearAdminSession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: adminConsoleOrigin().startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
