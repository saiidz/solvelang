import assert from "node:assert/strict";
import test from "node:test";
import { magicTokenFromHash, normalizeApiBase } from "./customer-api";

test("normalizes an HTTPS API base URL", () => {
  assert.equal(normalizeApiBase("https://api.solve-lang.com///"), "https://api.solve-lang.com");
  assert.equal(normalizeApiBase(undefined), "");
  assert.throws(() => normalizeApiBase("http://localhost:3000"), /HTTPS/);
});

test("accepts only correctly shaped magic-link tokens", () => {
  const token = `ml_${"a".repeat(24)}_${"B".repeat(43)}`;
  assert.equal(magicTokenFromHash(`#magic_token=${token}`), token);
  assert.equal(magicTokenFromHash("#magic_token=bad"), null);
  assert.equal(magicTokenFromHash("#other=value"), null);
});
