import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const site = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("../", import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(site, "app/run/wasmPreviewPin.json")));
assert.match(pin.sourceCommit, /^[a-f0-9]{40}$/);
assert.match(pin.manifestSha256, /^[a-f0-9]{64}$/);
assert.equal(pin.baseUrl, `/wasm/${pin.sourceCommit}/`);
const directory = path.join(site, "public", pin.baseUrl);
const names = ["manifest.json", "solvec_wasm.js", "solvec_wasm_bg.js", "solvec_wasm_bg.wasm"];
assert.deepEqual(fs.readdirSync(directory).sort(), names);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const policyBytes = fs.readFileSync(new URL("../../solvec-wasm/qa/artifact-policy.json", import.meta.url));
const policy = JSON.parse(policyBytes);
const read = (name, maximum) => {
  const file = path.join(directory, name);
  const info = fs.lstatSync(file);
  assert.ok(info.isFile() && info.size > 0 && info.size <= maximum, "invalid pinned asset");
  return fs.readFileSync(file);
};
const manifestBytes = read("manifest.json", 16384);
assert.equal(hash(manifestBytes), pin.manifestSha256, "qualification manifest differs from trusted pin");
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.sourceCommit, pin.sourceCommit);
assert.equal(manifest.schema, "solvelang.wasm-artifact-audit");
assert.equal(manifest.version, 1);
assert.equal(manifest.policySha256, hash(policyBytes));
assert.deepEqual(manifest.imports, policy.imports);
assert.deepEqual(manifest.exports, policy.exports);
assert.deepEqual(manifest.files.map(file => file.name), names.slice(1));
let total = 0;
for (const file of manifest.files) {
  const bytes = read(file.name, 600000);
  assert.equal(bytes.byteLength, file.bytes);
  assert.equal(hash(bytes), file.sha256, "pinned artifact bytes changed");
  if (file.name.endsWith(".js")) assert.equal(file.sha256, policy.glueSha256[file.name]);
  total += bytes.byteLength;
  if (file.name.endsWith(".wasm")) {
    const wasmModule = new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(wasmModule), manifest.imports);
    assert.deepEqual(WebAssembly.Module.exports(wasmModule), manifest.exports);
  }
}
assert.equal(total, manifest.totalBytes);
assert.ok(total <= 620000);
console.log(`Verified pinned browser artifact ${pin.sourceCommit}; no Rust toolchain used.`);
