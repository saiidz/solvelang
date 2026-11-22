import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgentEvalMatrix } from "./generate-agent-eval-matrix.mjs";

// Tier 2 entry point for the agent-eval matrix generator. The Tier 1 CLI
// (generate-agent-eval-matrix.mjs) is deliberately argument-free and pinned
// to the Tier 1 registry, so Tier 2 gets its own pinned entry point here
// instead of an argument or a forked implementation: every cell, record
// template, run-log template, and checklist line comes from the same
// generateAgentEvalMatrix code path Tier 1 uses.
const REGISTRY_PATH = "benchmarks/agent-eval-fixtures-v2-tier2.json";

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Tier 2 agent eval matrix generator accepts no file, URL, or credential arguments.");
  }
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const registry = JSON.parse(await readFile(path.join(packageRoot, REGISTRY_PATH), "utf8"));
  const suites = {};
  for (const fixture of registry.fixtures ?? []) {
    if (!suites[fixture.sourceSuite]) {
      suites[fixture.sourceSuite] = JSON.parse(await readFile(path.join(packageRoot, fixture.sourceSuite), "utf8"));
    }
  }
  const matrix = generateAgentEvalMatrix(registry, suites);
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("generate-agent-eval-matrix-tier2.mjs")) {
  main().catch((error) => {
    process.stderr.write(`context-agent-eval-matrix-tier2: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
