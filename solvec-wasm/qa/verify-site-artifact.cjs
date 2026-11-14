const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyPackage } = require("./package-artifact.cjs");

const WASM_PAYLOAD = "solvec_wasm_bg.wasm";

function comparePayloads(pinned, fresh, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    assert.deepEqual(pinned.files, fresh.files, "Site runtime is stale: qualify and review a new artifact pin before switching it.");
    return;
  }
  // Host-aware compare (owner decision, Nov 14 2026, option (b)): the
  // shipped artifact is the Linux-qualified build. Other hosts' rust-lld
  // output differs in segment layout, so this host's WASM payload bytes
  // are recorded below instead of compared; byte-identity stays enforced
  // on Linux builds. The file inventory and the JS glue bytes must still
  // match the pin exactly on every host.
  const strip = (files) => files.filter((file) => file.name !== WASM_PAYLOAD);
  assert.deepEqual(strip(pinned.files), strip(fresh.files), "Site runtime is stale: qualify and review a new artifact pin before switching it.");
  const pinnedWasm = pinned.files.find((file) => file.name === WASM_PAYLOAD);
  const freshWasm = fresh.files.find((file) => file.name === WASM_PAYLOAD);
  assert.ok(pinnedWasm && freshWasm, "audited artifact payload is missing the WASM binary");
  console.log(`Host-aware compare on ${platform}: fresh ${WASM_PAYLOAD} sha256=${freshWasm.sha256} bytes=${freshWasm.bytes}; Linux pin sha256=${pinnedWasm.sha256} bytes=${pinnedWasm.bytes}. Byte-identity is enforced on Linux only; the shipped artifact remains the Linux-qualified build.`);
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
  console.log(process.platform === "linux"
    ? "Pinned site runtime matches the current source's audited artifact bytes."
    : "Pinned site runtime matches the current source's audited artifact on this host (host-aware compare; WASM byte-identity enforced on Linux).");
}
module.exports = { comparePayloads };
