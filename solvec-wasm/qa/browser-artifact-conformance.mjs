import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { audit } = require("./audit-artifact.cjs");
const { runFixedLimitConformance } = require("./wasm-conformance.cjs");
const directory = path.resolve(process.argv[2]);
audit(directory, process.argv[3]);
const binding = await import(pathToFileURL(path.join(directory, "solvec_wasm_bg.js")));
const module = new WebAssembly.Module(fs.readFileSync(path.join(directory, "solvec_wasm_bg.wasm")));
const instance = new WebAssembly.Instance(module, {
  "./solvec_wasm_bg.js": { __wbindgen_init_externref_table: binding.__wbindgen_init_externref_table },
});
binding.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
const manifest = JSON.parse(fs.readFileSync(new URL("../../conformance/browser-preview-v1.json", import.meta.url)));
for (const fixture of manifest.cases) {
  const result = JSON.parse(binding.run_pure_v1(fixture.source, ""));
  assert.equal(result.ok, fixture.expect.outcome === "success", fixture.id);
  if (result.ok) assert.deepEqual(result.outputs, fixture.expect.outputs, fixture.id);
  else assert.equal(result.error.kind, fixture.expect.canonical_error, fixture.id);
}
const calls = [
  'http_get("https://invalid.example")', 'http_post("https://invalid.example", "x")',
  'read_file("secret")', 'write_file("secret", "x")', 'env("SECRET")',
  'missing()', 'fetch("x")', 'eval("x")', 'spawn("x")', 'localStorage("x")',
];
for (const call of calls) {
  for (const source of [call, `if false { ${call} }`, `fn unused() { ${call} }`]) {
    const result = JSON.parse(binding.run_pure_v1(`print("MUST NOT PRINT")\n${source}\n`, ""));
    assert.equal(result.ok, false, source);
    assert.equal(result.error.kind, "capability_denied", source);
    assert.deepEqual(result.outputs, [], source);
  }
}
runFixedLimitConformance(binding.run_pure_v1);
console.log(`Browser artifact PASS: ${manifest.cases.length} shared fixtures, ${calls.length * 3} deny-before-output cases, and 6 fixed limit cases`);
