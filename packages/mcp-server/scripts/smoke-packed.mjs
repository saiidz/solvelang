import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const expectedFiles = [
  "package/LICENSE",
  "package/README.md",
  "package/dist/src/index.d.ts",
  "package/dist/src/index.js",
  "package/dist/src/n8n.d.ts",
  "package/dist/src/n8n.js",
  "package/dist/src/solve-graph-alternative-paths.d.ts",
  "package/dist/src/solve-graph-alternative-paths.js",
  "package/dist/src/solve-graph-ranked-search.d.ts",
  "package/dist/src/solve-graph-ranked-search.js",
  "package/dist/src/solve-graph-shortest-path-explanation.d.ts",
  "package/dist/src/solve-graph-shortest-path-explanation.js",
  "package/dist/src/solve-graph-shortest-path.d.ts",
  "package/dist/src/solve-graph-shortest-path.js",
  "package/dist/src/solve-graph.d.ts",
  "package/dist/src/solve-graph.js",
  "package/dist/src/workspace.d.ts",
  "package/dist/src/workspace.js",
  "package/package.json",
];

assert.equal(manifest.name, "@solvelang/mcp-server");
assert.equal(manifest.private, false, "package must explicitly opt out of npm private mode");
assert.equal(manifest.publishConfig?.access, "public", "scoped package must explicitly publish with public access");
assert.equal(manifest.bin?.["solvelang-mcp"], "dist/src/index.js");

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "solvelang-packed-"));
try {
  const npmEnvironment = { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache") };
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", temporaryRoot], {
    cwd: packageRoot,
    env: npmEnvironment,
    maxBuffer: 10 * 1024 * 1024,
  });
  const [packResult] = JSON.parse(stdout);
  const packedFiles = packResult.files.map(({ path: filePath }) => `package/${filePath}`).sort();
  assert.deepEqual(packedFiles, expectedFiles, "tarball contents must match the reviewed runtime allowlist");

  const executable = packResult.files.find(({ path: filePath }) => filePath === "dist/src/index.js");
  assert.ok(executable, "packed CLI entrypoint is missing");
  assert.equal(executable.mode & 0o111, 0o111, "packed CLI entrypoint must be executable");

  const consumerRoot = path.join(temporaryRoot, "consumer");
  await mkdir(consumerRoot);
  await writeFile(path.join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n');
  const tarballPath = path.join(temporaryRoot, packResult.filename);
  await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerRoot,
    env: npmEnvironment,
    maxBuffer: 10 * 1024 * 1024,
  });

  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await mkdir(workspaceRoot);
  const child = execFile("npx", ["--no-install", "solvelang-mcp"], {
    cwd: consumerRoot,
    env: { ...npmEnvironment, SOLVELANG_WORKSPACE_ROOT: workspaceRoot },
  });
  const startup = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`packaged server did not start: ${stderr}`)), 10_000);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes("SolveLang MCP server running")) {
        clearTimeout(timer);
        resolve(stderr);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!stderr.includes("SolveLang MCP server running")) {
        clearTimeout(timer);
        reject(new Error(`packaged server exited with ${code}: ${stderr}`));
      }
    });
  });
  assert.match(startup, /SolveLang MCP server running/);
  child.kill("SIGTERM");
  console.log(`Packed smoke test passed: ${packResult.filename}`);
  console.log(expectedFiles.join("\n"));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
