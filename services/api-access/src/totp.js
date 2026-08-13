import { createHmac, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function encodeBase32(value) {
  const bytes = Buffer.from(value);
  let bits = 0;
  let bitCount = 0;
  let output = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) output += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
  return output;
}

export function decodeBase32(value) {
  if (typeof value !== "string") throw new Error("TOTP secret is invalid.");
  const normalized = value.toUpperCase().replace(/[=\s-]/g, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error("TOTP secret is invalid.");
  let bits = 0;
  let bitCount = 0;
  const bytes = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("TOTP secret is invalid.");
    bits = (bits << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }
  return Buffer.from(bytes);
}

function counterBuffer(step) {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("TOTP step is invalid.");
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(step));
  return buffer;
}

function equalCode(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function totpStep(timestamp = Date.now(), periodSeconds = TOTP_PERIOD_SECONDS) {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error("TOTP timestamp is invalid.");
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds < 1) throw new Error("TOTP period is invalid.");
  return Math.floor(timestamp / 1_000 / periodSeconds);
}

export function generateTotpCode(secretBase32, step, digits = TOTP_DIGITS) {
  if (!Number.isSafeInteger(digits) || digits < 6 || digits > 8) throw new Error("TOTP digits are invalid.");
  const key = decodeBase32(secretBase32);
  if (key.length < 16) throw new Error("TOTP secret is too short.");
  const digest = createHmac("sha1", key).update(counterBuffer(step)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

export function matchingTotpStep(secretBase32, presented, timestamp = Date.now(), window = 1) {
  if (typeof presented !== "string" || !/^\d{6}$/.test(presented)) return undefined;
  if (!Number.isSafeInteger(window) || window < 0 || window > 2) throw new Error("TOTP window is invalid.");
  const current = totpStep(timestamp);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = current + offset;
    if (candidate >= 0 && equalCode(generateTotpCode(secretBase32, candidate), presented)) return candidate;
  }
  return undefined;
}

export function authenticatorUri({ secret, accountLabel, issuer = "SolveLang" }) {
  if (typeof accountLabel !== "string" || !accountLabel.trim()) throw new Error("Authenticator account label is required.");
  const normalizedIssuer = String(issuer).trim();
  if (!normalizedIssuer) throw new Error("Authenticator issuer is required.");
  decodeBase32(secret);
  const label = encodeURIComponent(`${normalizedIssuer}:${accountLabel.trim()}`);
  const query = new URLSearchParams({
    secret,
    issuer: normalizedIssuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
