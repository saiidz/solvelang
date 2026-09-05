"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { audit } = require("./audit-artifact.cjs");

// Mutation tests use the actual pinned build, not a second model of the policy.
const built = process.env.SOLVELANG_WASM_AUDIT_DIR;
assert.ok(built, "SOLVELANG_WASM_AUDIT_DIR must identify the built bundle");
const sha = "a".repeat(40);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solvelang-wasm-audit-"));
  fs.cpSync(built, root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("reviewed actual artifact is deterministic and carries integrity", () => {
  assert.deepEqual(audit(built, sha), audit(built, sha));
  assert.equal(audit(built, sha).files.length, 3);
});
test("rejects injected browser side effects", t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "solvec_wasm_bg.js"), "\nfetch('/leak');\n");
  assert.throws(() => audit(root, sha), /unreviewed browser glue/);
});
test("rejects oversized artifacts before compilation", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "solvec_wasm_bg.wasm"), Buffer.alloc(600001));
  assert.throws(() => audit(root, sha), /size budget/);
});
test("rejects a WASI import without executing it", t => {
  const root = fixture(t);
  const text = s => [...Buffer.from(s)];
  const module = text("wasi_snapshot_preview1"), name = text("fd_write");
  const imports = [1, module.length, ...module, name.length, ...name, 0, 0];
  const wasm = Buffer.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,imports.length,...imports]);
  fs.writeFileSync(path.join(root, "solvec_wasm_bg.wasm"), wasm);
  assert.throws(() => audit(root, sha), /unapproved WASM imports/);
});
test("rejects extra artifact and invalid source identity", t => {
  assert.throws(() => audit(built, "main"), /source commit/);
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "unreviewed.js"), "");
  assert.throws(() => audit(root, sha), /unexpected artifact set/);
});
