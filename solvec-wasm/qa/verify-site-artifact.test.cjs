const assert = require("node:assert/strict");
const test = require("node:test");
const { comparePayloads } = require("./verify-site-artifact.cjs");

const files = [{ name: "runtime.wasm", bytes: 42, sha256: "a", integrity: "b" }];
test("payload comparison permits unchanged artifacts across source-only metadata changes", () => {
  comparePayloads({ sourceCommit: "older", files }, { sourceCommit: "newer", files: structuredClone(files) });
});
for (const field of ["name", "bytes", "sha256", "integrity"]) {
  test(`payload comparison rejects changed ${field}`, () => {
    const changed = structuredClone(files);
    changed[0][field] = field === "bytes" ? 43 : "changed";
    assert.throws(() => comparePayloads({ files }, { files: changed }), /Site runtime is stale/);
  });
}

const wasmFiles = [
  { name: "solvec_wasm.js", bytes: 10, sha256: "glue", integrity: "g" },
  { name: "solvec_wasm_bg.wasm", bytes: 42, sha256: "a", integrity: "b" },
];
test("host-aware compare records a different host WASM build", () => {
  const changed = structuredClone(wasmFiles);
  changed[1].bytes = 43;
  changed[1].sha256 = "other";
  changed[1].integrity = "other";
  comparePayloads({ files: wasmFiles }, { files: changed }, { platform: "darwin" });
});
test("host-aware compare still rejects changed glue bytes", () => {
  const changed = structuredClone(wasmFiles);
  changed[0].sha256 = "changed";
  assert.throws(() => comparePayloads({ files: wasmFiles }, { files: changed }, { platform: "darwin" }), /Site runtime is stale/);
});
test("host-aware compare still rejects a missing WASM payload", () => {
  const changed = structuredClone(wasmFiles).slice(0, 1);
  assert.throws(() => comparePayloads({ files: wasmFiles }, { files: changed }, { platform: "win32" }));
});
test("linux compare rejects a different WASM build", () => {
  const changed = structuredClone(wasmFiles);
  changed[1].sha256 = "other";
  assert.throws(() => comparePayloads({ files: wasmFiles }, { files: changed }, { platform: "linux" }), /Site runtime is stale/);
});
