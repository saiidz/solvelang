import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PATTERN = /^sl_(test|live)_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/;

function assertMode(mode) {
  if (mode !== "test" && mode !== "live") throw new Error("API key mode must be test or live.");
}

function assertPepper(pepper) {
  if (typeof pepper !== "string" || pepper.length < 32) throw new Error("API key pepper must contain at least 32 characters.");
}

export function generateApiKey(mode, random = randomBytes) {
  assertMode(mode);
  const keyId = random(12).toString("hex");
  const secret = random(32).toString("base64url");
  const apiKey = `sl_${mode}_${keyId}_${secret}`;
  return {
    apiKey,
    keyId,
    mode,
    secret,
    prefix: `sl_${mode}_${keyId.slice(0, 8)}`,
    lastFour: secret.slice(-4),
  };
}

export function parseApiKey(value) {
  if (typeof value !== "string") throw new Error("API key is invalid.");
  const match = KEY_PATTERN.exec(value.trim());
  if (!match) throw new Error("API key is invalid.");
  return { mode: match[1], keyId: match[2], secret: match[3] };
}

export function fingerprintApiKey({ mode, keyId, secret, pepper }) {
  assertMode(mode);
  assertPepper(pepper);
  if (!/^[a-f0-9]{24}$/.test(keyId)) throw new Error("API key identifier is invalid.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("API key secret is invalid.");
  return createHmac("sha256", pepper)
    .update(`solvelang-api-key:v1:${mode}:${keyId}:${secret}`)
    .digest("hex");
}

export function verifyApiKeyFingerprint({ presented, expectedHex }) {
  if (typeof expectedHex !== "string" || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  if (typeof presented !== "string" || !/^[a-f0-9]{64}$/.test(presented)) return false;
  const left = Buffer.from(presented, "hex");
  const right = Buffer.from(expectedHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(header) {
  if (typeof header !== "string") throw new Error("Authorization header is missing.");
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  if (!match) throw new Error("Authorization header is invalid.");
  return match[1];
}
