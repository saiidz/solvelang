import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  encodeScryptPassword,
  originAllowed,
  verifyScryptPassword,
  verifySessionToken,
} from "../lib/auth-core";

test("scrypt admin passwords verify without storing plaintext", () => {
  const encoded = encodeScryptPassword("correct horse battery staple", Buffer.alloc(24, 7));
  assert.match(encoded, /^[a-f0-9]+:[a-f0-9]+$/);
  assert.equal(verifyScryptPassword("correct horse battery staple", encoded), true);
  assert.equal(verifyScryptPassword("wrong password here", encoded), false);
  assert.doesNotMatch(encoded, /correct horse/);
});

test("signed sessions are bounded, tamper-evident, and expire", () => {
  const secret = "s".repeat(64);
  const now = 1_800_000_000_000;
  const token = createSessionToken(secret, now, 60_000);
  const session = verifySessionToken(token, secret, now + 10_000);
  assert.ok(session);
  assert.equal(session?.issuedAt, now);
  assert.equal(session?.expiresAt, now + 60_000);
  assert.equal(verifySessionToken(token, secret, now + 60_001), null);

  const [payload, signature] = token.split(".");
  assert.equal(verifySessionToken(`${payload}x.${signature}`, secret, now), null);
  assert.equal(verifySessionToken(token, "x".repeat(64), now), null);
});

test("origin comparison is exact at scheme, host, and port boundaries", () => {
  assert.equal(originAllowed("https://admin.solve-lang.com", "https://admin.solve-lang.com"), true);
  assert.equal(originAllowed("https://admin.solve-lang.com/path", "https://admin.solve-lang.com"), true);
  assert.equal(originAllowed("http://admin.solve-lang.com", "https://admin.solve-lang.com"), false);
  assert.equal(originAllowed("https://admin.solve-lang.com.evil.example", "https://admin.solve-lang.com"), false);
  assert.equal(originAllowed("https://admin.solve-lang.com:444", "https://admin.solve-lang.com"), false);
  assert.equal(originAllowed(null, "https://admin.solve-lang.com"), false);
});
