// Builds the compiled kit the verification service consumes at
// runtime:
//   1. packages/pr-gate → dist/ (its own tsc build; provides the
//      GitHub receipt collector, the policy module's matchGlob, and
//      the gate CLI the service spawns).
//   2. the site's Change Impact Receipt core →
//      services/verification/dist-receipt/receipt.js, compiled
//      standalone (the builder is dependency-free by design), so the
//      service grades with the exact code the public page uses.
// Run on the deploy host from a full repo checkout before the image
// build (see README.md). Idempotent; safe to re-run.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serviceDir, "..", "..");
const prGateDir = path.join(repoRoot, "packages", "pr-gate");
const tscBin = path.join(prGateDir, "node_modules", ".bin", "tsc");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`build-kit: failed: ${command} ${args.join(" ")} (exit ${result.status})`);
    process.exit(1);
  }
}

if (!existsSync(tscBin)) {
  run("npm", ["ci"], prGateDir);
}
run("npm", ["run", "build"], prGateDir);

const receiptSource = path.join(
  repoRoot,
  "site/app/change-impact-receipt/core/receipt.ts"
);
const receiptOutDir = path.join(serviceDir, "dist-receipt");
run(
  tscBin,
  [
    receiptSource,
    "--outDir", receiptOutDir,
    "--module", "commonjs",
    "--target", "es2022",
    "--moduleResolution", "node",
    "--skipLibCheck",
  ],
  repoRoot
);

// The compiled receipt core is CommonJS inside an ESM package —
// rename it to .cjs so Node loads it as CJS through createRequire.
await rename(
  path.join(receiptOutDir, "receipt.js"),
  path.join(receiptOutDir, "receipt.cjs")
);

const expected = [
  path.join(prGateDir, "dist/packages/pr-gate/src/github-receipt.js"),
  path.join(prGateDir, "dist/packages/pr-gate/src/cli.js"),
  path.join(prGateDir, "dist/packages/pr-gate/src/policy.js"),
  path.join(receiptOutDir, "receipt.cjs"),
];
for (const artifact of expected) {
  if (!existsSync(artifact)) {
    console.error(`build-kit: missing artifact ${artifact}`);
    process.exit(1);
  }
}
console.log("build-kit: kit ready");
