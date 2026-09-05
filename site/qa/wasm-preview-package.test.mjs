import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const site = fileURLToPath(new URL("../", import.meta.url));
const pinPath = path.join(site, "app/run/wasmPreviewPin.json");
const pin = JSON.parse(fs.readFileSync(pinPath));
const verify = root => spawnSync(process.execPath, [path.join(site, "qa/verify-wasm-preview.mjs"), root], { encoding: "utf8" });

test("committed browser package verifies using Node only", () => {
  const result = verify(site);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no Rust toolchain/);
});

for (const mutation of ["missing", "corrupt", "manifest", "extra", "symlink"]) {
  test(`static build verification rejects ${mutation} candidate assets`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "solvelang-preview-pin-"));
    try {
      fs.mkdirSync(path.join(root, "app/run"), { recursive: true });
      fs.copyFileSync(pinPath, path.join(root, "app/run/wasmPreviewPin.json"));
      const directory = path.join(root, "public", pin.baseUrl);
      fs.cpSync(path.join(site, "public", pin.baseUrl), directory, { recursive: true });
      const wasm = path.join(directory, "solvec_wasm_bg.wasm");
      if (mutation === "missing") fs.unlinkSync(wasm);
      if (mutation === "corrupt") fs.writeFileSync(wasm, "bad");
      if (mutation === "manifest") fs.writeFileSync(path.join(directory, "manifest.json"), "{}");
      if (mutation === "extra") fs.writeFileSync(path.join(directory, "extra.js"), "bad");
      if (mutation === "symlink") { fs.unlinkSync(wasm); fs.symlinkSync(path.join(site, "public", pin.baseUrl, "solvec_wasm_bg.wasm"), wasm); }
      assert.notEqual(verify(root).status, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
