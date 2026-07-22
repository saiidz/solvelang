import { createHmac, timingSafeEqual } from "node:crypto";

export type EntitlementClaims = {
  version: 1;
  scanId: string;
  // Compatibility field: this stores a Stripe PaymentIntent ID (`pi_...`).
  sessionId: string;
  exp: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signPart(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueEntitlement(claims: EntitlementClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${signPart(payload, secret)}`;
}

export function verifyEntitlement(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): EntitlementClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Malformed entitlement token.");

  const expected = Buffer.from(signPart(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid entitlement signature.");
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EntitlementClaims;
  if (parsed.version !== 1 || !parsed.scanId || !parsed.sessionId || !Number.isInteger(parsed.exp)) {
    throw new Error("Invalid entitlement claims.");
  }
  if (parsed.exp <= nowSeconds) throw new Error("Entitlement token expired.");
  return parsed;
}
