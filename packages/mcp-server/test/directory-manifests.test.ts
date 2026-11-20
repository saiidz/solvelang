import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");

test("glama.json at the repo root names saiidz as maintainer", () => {
  const glama = JSON.parse(readFileSync(path.join(repoRoot, "glama.json"), "utf8")) as Record<string, any>;
  assert.equal(glama.$schema, "https://glama.ai/mcp/schemas/server.json");
  assert.deepEqual(glama.maintainers, ["saiidz"]);
});

test("smithery.yaml launches the published npm package over stdio", () => {
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as Record<string, any>;
  const yaml = readFileSync(path.join(packageRoot, "smithery.yaml"), "utf8");

  assert.match(yaml, /type:\s*stdio/);
  assert.ok(
    yaml.includes(`'@solvelang/mcp-server@${pkg.version}'`),
    "smithery.yaml must pin the current package version",
  );
  assert.ok(yaml.includes("'solvelang-mcp'"), "smithery.yaml must invoke the solvelang-mcp bin");
  assert.ok(
    yaml.includes("SOLVELANG_WORKSPACE_ROOT"),
    "smithery.yaml must forward the optional workspace root",
  );
});
