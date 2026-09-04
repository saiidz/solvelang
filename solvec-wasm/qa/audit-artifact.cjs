"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("./artifact-policy.json");

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const names = ["solvec_wasm.js", "solvec_wasm_bg.js", "solvec_wasm_bg.wasm"];

function audit(directory, sourceCommit) {
  assert.equal(process.versions.node.split(".")[0], "24", "Node 24 qualification runtime required");
  assert.match(sourceCommit, /^[a-f0-9]{40}$/, "full source commit required");
  assert.deepEqual(fs.readdirSync(directory).sort(), names, "unexpected artifact set");
  let totalBytes = 0;
  const files = names.map(name => {
    const file = path.join(directory, name);
    assert.ok(fs.lstatSync(file).isFile(), "artifact must be a regular file");
    const size = fs.statSync(file).size;
    assert.ok(size > 0 && size <= policy.maxWasmBytes, "artifact size budget exceeded");
    totalBytes += size;
    const bytes = fs.readFileSync(file);
    if (name in policy.glueSha256) {
      // Exact reviewed glue bytes: reject any callback/loader/host bridge drift.
      assert.equal(sha256(bytes), policy.glueSha256[name], `${name}: unreviewed browser glue`);
    } else {
      // Compilation inspects the import/export tables without instantiation or execution.
      const module = new WebAssembly.Module(bytes);
      assert.deepEqual(WebAssembly.Module.imports(module), policy.imports, "unapproved WASM imports");
      assert.deepEqual(WebAssembly.Module.exports(module), policy.exports, "unapproved WASM exports");
    }
    return { name, bytes: size, sha256: sha256(bytes), integrity: `sha256-${crypto.createHash("sha256").update(bytes).digest("base64")}` };
  });
  assert.ok(totalBytes <= policy.maxBundleBytes, "bundle size budget exceeded");
  return {
    schema: "solvelang.wasm-artifact-audit", version: 1, sourceCommit,
    publishable: false, browserPreviewReplaced: false,
    rust: policy.rust, wasmBindgen: policy.wasmBindgen, node: process.versions.node,
    policySha256: sha256(fs.readFileSync(path.join(__dirname, "artifact-policy.json"))),
    totalBytes, files, imports: policy.imports, exports: policy.exports,
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(audit(process.argv[2], process.argv[3]), null, 2)}\n`);
}
module.exports = { audit };
