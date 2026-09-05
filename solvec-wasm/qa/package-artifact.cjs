"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { audit } = require("./audit-artifact.cjs");

// Packaging has no compiler path: its only inputs are already-audited bytes.
function packageArtifact(bundle, destination, sourceCommit) {
  const manifest = audit(bundle, sourceCommit);
  assert.ok(!fs.existsSync(destination), "package destination must not already exist");
  fs.mkdirSync(destination, { recursive: true });
  try {
    for (const file of manifest.files) {
      fs.copyFileSync(path.join(bundle, file.name), path.join(destination, file.name), fs.constants.COPYFILE_EXCL);
    }
    fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    verifyPackage(destination, sourceCommit);
  } catch (error) {
    // An incomplete destination is never returned as qualified evidence.
    throw error;
  }
  return manifest;
}

function verifyPackage(directory, sourceCommit) {
  const expected = ["manifest.json", "solvec_wasm.js", "solvec_wasm_bg.js", "solvec_wasm_bg.wasm"];
  assert.deepEqual(fs.readdirSync(directory).sort(), expected, "unexpected packaged artifact set");
  const manifestPath = path.join(directory, "manifest.json");
  assert.ok(fs.lstatSync(manifestPath).isFile(), "manifest must be a regular file");
  assert.ok(fs.statSync(manifestPath).size <= 16384, "manifest exceeds byte bound");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const temporary = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "solvelang-package-check-"));
  try {
    for (const name of expected.slice(1)) {
      const file = path.join(directory, name);
      assert.ok(fs.lstatSync(file).isFile(), "package entries must be regular files");
      assert.ok(fs.statSync(file).size <= 600000, "package entry exceeds byte bound");
      fs.copyFileSync(file, path.join(temporary, name));
    }
    assert.match(manifest.node, /^24\.\d+\.\d+$/, "package must record a Node 24 qualification runtime");
    const currentAudit = audit(temporary, sourceCommit);
    assert.deepEqual(manifest, { ...currentAudit, node: manifest.node }, "package manifest does not match audited source/artifact");
    return manifest;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function retainPackage(source, destination, sourceCommit) {
  verifyPackage(source, sourceCommit);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  return verifyPackage(destination, sourceCommit);
}

if (require.main === module) {
  if (process.argv[2] === "--retain") retainPackage(process.argv[3], process.argv[4], process.argv[5]);
  else packageArtifact(process.argv[2], process.argv[3], process.argv[4]);
}
module.exports = { packageArtifact, verifyPackage, retainPackage };
