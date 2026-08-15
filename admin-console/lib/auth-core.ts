import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type AdminSession = {
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyScryptPassword(password: string, encoded: string) {
  if (typeof password !== "string" || password.length < 12 || password.length > 512) return false;
  if (typeof encoded !== "string") return false;
  const [saltHex, keyHex, extra] = encoded.split(":");
  if (extra !== undefined || !/^[a-f0-9]{32,128}$/i.test(saltHex ?? "") || !/^[a-f0-9]{128}$/i.test(keyHex ?? "")) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return safeEqual(actual, expected);
}

export function encodeScryptPassword(password: string, salt = randomBytes(24)) {
  if (typeof password !== "string" || password.length < 12 || password.length > 512) {
    throw new Error("Admin password must be between 12 and 512 characters.");
  }
  const key = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret: string, now = Date.now(), ttlMs = 8 * 60 * 60 * 1000) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Admin session secret must be at least 32 characters.");
  const session: AdminSession = {
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: randomBytes(24).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): AdminSession | null {
  if (typeof token !== "string" || typeof secret !== "string" || secret.length < 32) return null;
  const [payload, presentedSignature, extra] = token.split(".");
  if (!payload || !presentedSignature || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, secret));
  const presented = Buffer.from(presentedSignature);
  if (!safeEqual(expected, presented)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt)) return null;
    if (typeof parsed.nonce !== "string" || parsed.nonce.length < 20) return null;
    if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000) return null;
    if (parsed.expiresAt - parsed.issuedAt > 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function originAllowed(presented: string | null, expected: string) {
  if (typeof expected !== "string" || !/^https?:\/\//.test(expected)) return false;
  if (!presented) return false;
  try {
    return new URL(presented).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}
