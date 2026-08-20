import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCargoManifest } from "./cargoEvidence";
test("parses bounded local Cargo package and dependency evidence without registry resolution", () => { const result = analyzeCargoManifest('[package]\nname = "demo"\n[dependencies]\nserde = "1"\nlocal = { path = "../local" }\n[dev-dependencies]\ninsta = "1"'); assert.equal(result.packageName, "demo"); assert.deepEqual(result.dependencies.map((item) => item.name), ["insta", "local", "serde"]); assert.equal(result.dependencies.find((item) => item.name === "local")?.pathState, "outside-scan"); assert.deepEqual(result.execution, { networkAccess: false, writeAccess: false, registryResolution: false }); });
