import assert from "node:assert/strict";
import test from "node:test";
import { issueEntitlement, verifyEntitlement } from "../src/token.js";

const secret = "a-very-long-test-secret-that-is-not-production";

test("issues and verifies an entitlement", () => {
  const token = issueEntitlement({ version: 1, scanId: "scan-1", sessionId: "cs_test_1", exp: 2000 }, secret);
  const claims = verifyEntitlement(token, secret, 1000);
  assert.equal(claims.scanId, "scan-1");
  assert.equal(claims.sessionId, "cs_test_1");
});

test("rejects tampering", () => {
  const token = issueEntitlement({ version: 1, scanId: "scan-1", sessionId: "cs_test_1", exp: 2000 }, secret);
  assert.throws(() => verifyEntitlement(`${token}x`, secret, 1000), /signature/);
});

test("rejects expired tokens", () => {
  const token = issueEntitlement({ version: 1, scanId: "scan-1", sessionId: "cs_test_1", exp: 1000 }, secret);
  assert.throws(() => verifyEntitlement(token, secret, 1000), /expired/);
});
