const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyPackage } = require("./package-artifact.cjs");

function comparePayloads(pinned, fresh) {
  assert.deepEqual(pinned.files, fresh.files, "Site runtime is stale: qualify and review a new artifact pin before switching it.");
}

if (require.main === module) {
  const pin = require("../../site/app/run/wasmPreviewPin.json");
  assert.match(pin.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(pin.baseUrl, `/wasm/${pin.sourceCommit}/`);
  const directory = path.resolve(__dirname, "../../site/public", `.${pin.baseUrl}`);
  const manifestBytes = fs.readFileSync(path.join(directory, "manifest.json"));
  assert.equal(crypto.createHash("sha256").update(manifestBytes).digest("hex"), pin.manifestSha256);
  const pinned = verifyPackage(directory, pin.sourceCommit);
  const fresh = verifyPackage(process.argv[2], process.argv[3]);
  comparePayloads(pinned, fresh);
  console.log("Pinned site runtime matches the current source's audited artifact bytes.");
}
module.exports = { comparePayloads };
