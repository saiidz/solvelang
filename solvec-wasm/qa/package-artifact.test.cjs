"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { packageArtifact, verifyPackage } = require("./package-artifact.cjs");
const bundle = process.env.SOLVELANG_WASM_AUDIT_DIR;
const commit = process.env.SOLVELANG_WASM_SOURCE_COMMIT;
assert.ok(bundle && commit, "real audited artifact and exact source commit are required");

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solvelang-package-test-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("packaging is deterministic and binds the exact audited source", () => fixture(root => {
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  packageArtifact(bundle, first, commit);
  packageArtifact(bundle, second, commit);
  for (const name of fs.readdirSync(first)) assert.deepEqual(fs.readFileSync(path.join(first, name)), fs.readFileSync(path.join(second, name)));
  assert.equal(verifyPackage(first, commit).publishable, false);
  assert.throws(() => verifyPackage(first, "0".repeat(40)), /manifest/);
  assert.throws(() => packageArtifact(bundle, first, commit), /already exist/);
}));

for (const mutation of ["missing", "extra", "corrupt", "oversized", "symlink", "manifest"]) {
  test(`package rejects ${mutation} artifacts before execution`, () => fixture(root => {
    const destination = path.join(root, "package");
    packageArtifact(bundle, destination, commit);
    const wasm = path.join(destination, "solvec_wasm_bg.wasm");
    if (mutation === "missing") fs.unlinkSync(wasm);
    if (mutation === "extra") fs.writeFileSync(path.join(destination, "unreviewed.js"), "");
    if (mutation === "corrupt") fs.writeFileSync(wasm, Buffer.from([0, 1, 2]));
    if (mutation === "oversized") fs.writeFileSync(wasm, Buffer.alloc(600001));
    if (mutation === "symlink") { fs.unlinkSync(wasm); fs.symlinkSync(path.join(bundle, "solvec_wasm_bg.wasm"), wasm); }
    if (mutation === "manifest") fs.writeFileSync(path.join(destination, "manifest.json"), "{}");
    assert.throws(() => verifyPackage(destination, commit));
  }));
}
