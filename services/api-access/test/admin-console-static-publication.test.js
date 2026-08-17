import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const staticDirectory = new URL("admin-console-static/", root);
const buildScript = new URL("build-release.mjs", staticDirectory);
const releaseFiles = ["index.html", "styles.css", "config.js", "app.js"];
const forbiddenBrowserSecretNames = /API_ACCESS_ADMIN_SECRET|SOLVELANG_ADMIN_UPSTREAM_SECRET|SOLVELANG_ADMIN_SESSION_SECRET|STRIPE_SECRET_KEY|CUSTOMER_AUTH_PEPPER|API_KEY_PEPPER/;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function source(filename) {
  return readFile(new URL(filename, staticDirectory));
}

test("static admin publication is same-origin, noindex, and browser-secret free", async () => {
  const index = (await source("index.html")).toString("utf8");
  const config = (await source("config.js")).toString("utf8");

  assert.match(index, /<meta name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(index, /connect-src 'self';/);
  assert.doesNotMatch(index, /connect-src[^;]*(?:https?:|\*)/);
  assert.match(index, /script-src 'self';/);
  assert.match(index, /frame-ancestors 'none';/);
  assert.match(index, /base-uri 'none';/);
  assert.match(index, /form-action 'self'/);
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:\/\//i);

  assert.match(config, /window\.SOLVELANG_ADMIN_GATEWAY_BASE = `\$\{window\.location\.origin\}\/admin-gateway`/);
  assert.doesNotMatch(config, /https?:\/\//);

  for (const filename of releaseFiles) {
    const contents = (await source(filename)).toString("utf8");
    assert.doesNotMatch(contents, forbiddenBrowserSecretNames, filename);
  }
});

test("static admin release builder emits a deterministic exact-file manifest", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "solvelang-admin-static-"));
  const outputDirectory = join(temporaryDirectory, "release");
  try {
    const first = spawnSync(process.execPath, [fileURLToPath(buildScript), outputDirectory], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const firstManifestText = await readFile(join(outputDirectory, "manifest.json"), "utf8");
    const firstManifest = JSON.parse(firstManifestText);
    assert.equal(firstManifest.schema, "solvelang.admin-console-static.v1");
    assert.deepEqual(Object.keys(firstManifest.files), releaseFiles);
    assert.match(firstManifest.bundleSha256, /^[a-f0-9]{64}$/);

    for (const filename of releaseFiles) {
      const original = await source(filename);
      const released = await readFile(join(outputDirectory, filename));
      assert.deepEqual(released, original, filename);
      assert.deepEqual(firstManifest.files[filename], {
        sha256: sha256(original),
        bytes: original.byteLength,
      });
    }

    const second = spawnSync(process.execPath, [fileURLToPath(buildScript), outputDirectory], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(await readFile(join(outputDirectory, "manifest.json"), "utf8"), firstManifestText);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
