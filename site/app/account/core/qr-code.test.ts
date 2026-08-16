import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeQrMatrix, qrSvgPath } from "./qr-code";

function digest(matrix: ReturnType<typeof encodeQrMatrix>): string {
  const bits = matrix.modules.flatMap((row) => row.map((dark) => dark ? "1" : "0")).join("");
  return createHash("sha256").update(bits).digest("hex");
}

test("QR encoder matches a reference version-1 matrix", () => {
  const matrix = encodeQrMatrix("SolveLang");
  assert.equal(matrix.version, 1);
  assert.equal(matrix.size, 21);
  assert.equal(matrix.modules.flat().filter(Boolean).length, 202);
  assert.equal(digest(matrix), "3f28d0d5bbe9a2413a70ca0c6419508d470e0a28a66a5e2be4bd814373edf57e");
});

test("QR encoder renders a production-shaped synthetic TOTP URI deterministically", () => {
  const value = "otpauth://totp/SolveLang%3Along-qr-canary-account-20260816%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SolveLang&algorithm=SHA1&digits=6&period=30";
  const matrix = encodeQrMatrix(value);
  assert.equal(matrix.version, 9);
  assert.equal(matrix.size, 53);
  assert.equal(matrix.modules.flat().filter(Boolean).length, 1414);
  assert.equal(digest(matrix), "226c42aae6c96725a350e8b80e02b445e24d1972c9ae603652b1451f676c1f79");
  const svg = qrSvgPath(matrix);
  assert.equal(svg.viewBoxSize, 61);
  assert.ok(svg.path.startsWith("M"));
  assert.equal(svg.path.includes("otpauth"), false);
  assert.equal(svg.path.includes("JBSWY3DP"), false);
});

test("QR encoder supports version 10 and fails closed to manual setup for oversized values", () => {
  const matrix = encodeQrMatrix("x".repeat(200));
  assert.equal(matrix.version, 10);
  assert.equal(matrix.size, 57);
  assert.equal(digest(matrix), "750d745db4aee09b5c9b697460b281158c0082a31e53c4f09d5f822ae023e10f");
  assert.throws(() => encodeQrMatrix("x".repeat(214)), /manual setup key/i);
});
