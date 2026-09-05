"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { packageArtifact, verifyPackage, retainPackage } = require("./package-artifact.cjs");
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

test("retention replaces stale entries and verifies the actual retained directory", () => fixture(root => {
  const source = path.join(root, "source");
  const retained = path.join(root, "retained");
  packageArtifact(bundle, source, commit);
  fs.mkdirSync(retained);
  fs.writeFileSync(path.join(retained, "stale.js"), "obsolete");
  retainPackage(source, retained, commit);
  assert.deepEqual(fs.readdirSync(retained).sort(), fs.readdirSync(source).sort());
}));

test("verification preserves recorded Node 24 patch provenance across patch changes", () => fixture(root => {
  const destination = path.join(root, "package");
  packageArtifact(bundle, destination, commit);
  const manifestPath = path.join(destination, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.node = "24.0.0";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(verifyPackage(destination, commit).node, "24.0.0");
  manifest.node = "22.0.0";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyPackage(destination, commit), /Node 24/);
}));
