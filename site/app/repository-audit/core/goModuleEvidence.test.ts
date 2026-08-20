import assert from "node:assert/strict";
import test from "node:test";
import { analyzeGoModuleManifest } from "./goModuleEvidence";

test("collects bounded local Go module evidence without resolving modules", () => {
  const result = analyzeGoModuleManifest(`
module example.com/service

require (
  example.com/api v1.2.0
  example.com/indirect v1.0.0 // indirect
)

replace example.com/api => ../api
replace example.com/remote => example.com/fork v1.4.0
`);

  assert.equal(result.modulePath, "example.com/service");
  assert.deepEqual(result.requirements, [
    { modulePath: "example.com/api", version: "v1.2.0", indirect: false },
    { modulePath: "example.com/indirect", version: "v1.0.0", indirect: true },
  ]);
  assert.deepEqual(result.localReplacements, [
    { modulePath: "example.com/api", target: "../api", state: "outside-scan" },
  ]);
  assert.deepEqual(result.execution, {
    networkAccess: false,
    writeAccess: false,
    moduleResolution: false,
  });
});

test("uses stable ordering and rejects oversized Go module text", () => {
  const result = analyzeGoModuleManifest(`
require example.com/z v1.0.0
require example.com/a v1.0.0
replace example.com/z => ./z
replace example.com/a => ./a
`);

  assert.deepEqual(result.requirements.map((item) => item.modulePath), ["example.com/a", "example.com/z"]);
  assert.deepEqual(result.localReplacements.map((item) => item.modulePath), ["example.com/a", "example.com/z"]);
  assert.throws(() => analyzeGoModuleManifest("x".repeat(1024 * 1024 + 1)), /1 MiB text bound/);
});
