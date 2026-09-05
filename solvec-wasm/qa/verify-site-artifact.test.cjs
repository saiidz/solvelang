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
