import { createAdminConsoleGateway } from "./gateway.js";

function required(name, minimum = 1) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

const application = createAdminConsoleGateway({
  upstreamBase: required("SOLVELANG_ADMIN_UPSTREAM_API_BASE"),
  upstreamSecret: required("SOLVELANG_ADMIN_UPSTREAM_SECRET", 32),
  adminOrigin: required("SOLVELANG_ADMIN_ORIGIN"),
  passwordHash: required("SOLVELANG_ADMIN_PASSWORD_SCRYPT", 64),
  sessionSecret: required("SOLVELANG_ADMIN_SESSION_SECRET", 32),
});

export async function handler(event) {
  return application(event);
}
