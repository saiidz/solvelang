#!/usr/bin/env node
// SolveLang Onboard — one-command onboarding for an existing repository.
//
//   solvelang-onboard [targetDir] [--out <dir>] [--budget-bytes <n>]
//
// Reads the target repository's own signals — AGENTS.md / CLAUDE.md,
// package manifests, git history, and directory layout — and generates:
//   .solve/workflows/*.solve   starter workflows for routine tasks
//   .solve/context-pack.json   an initial Solve Context pack, built by the
//                              MCP server's existing buildWorkspaceContextPack
//   .solve/onboard-report.md   the inference report: every generated block
//                              with the signal it came from
//
// Nothing is inferred beyond the signals: a fact that is not stated in the
// repo does not appear in the output. Exit codes follow the PR Gate
// convention: 0 = done, 2 = operational error.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildWorkspaceContextPack } from "../../mcp-server/src/context-workspace";

import { buildPackTask, generateWorkflows, renderReport, type PackSummary } from "./generate";
import { extractSignals, type RepoSignals } from "./signals";

export interface OnboardResult {
  target: string;
  outDir: string;
  signals: RepoSignals;
  files: string[];
  pack: PackSummary;
}

export async function runOnboard(
  targetDir: string,
  options: { outDir?: string; budgetBytes?: number } = {},
): Promise<OnboardResult> {
  const target = path.resolve(targetDir);
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(target, ".solve");

  const signals = extractSignals(target);

  // Build the pack BEFORE writing any generated files, so the pack reflects
  // the repository exactly as it was found. The pack machinery roots itself
  // at SOLVELANG_WORKSPACE_ROOT (packages/mcp-server/src/workspace.ts).
  const previousRoot = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = target;
  let workspacePack;
  try {
    workspacePack = await buildWorkspaceContextPack(buildPackTask(signals), {
      ...(options.budgetBytes ? { budgetBytes: options.budgetBytes } : {}),
    });
  } finally {
    if (previousRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previousRoot;
  }
  const pack: PackSummary = {
    packId: workspacePack.pack.packId,
    entries: workspacePack.pack.entries.length,
    selectedBytes: workspacePack.pack.selectedBytes,
    budgetBytes: workspacePack.pack.budgetBytes,
    truncated: workspacePack.pack.truncated,
  };

  const files = generateWorkflows(signals);
  const written: string[] = [];
  for (const file of files) {
    const destination = path.join(outDir, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
    written.push(destination);
  }
  const packPath = path.join(outDir, "context-pack.json");
  await writeFile(packPath, JSON.stringify(workspacePack, null, 2), "utf8");
  written.push(packPath);

  const reportPath = path.join(outDir, "onboard-report.md");
  await writeFile(
    reportPath,
    renderReport(signals, files, pack, path.basename(outDir)),
    "utf8",
  );
  written.push(reportPath);

  return { target, outDir, signals, files: written, pack };
}

interface CliOptions {
  target: string;
  outDir?: string;
  budgetBytes?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { target: "." };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") options.outDir = argv[++i];
    else if (arg === "--budget-bytes") options.budgetBytes = Number.parseInt(argv[++i], 10);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: solvelang-onboard [targetDir] [--out <dir>] [--budget-bytes <n>]");
      process.exit(0);
    } else positional.push(arg);
  }
  if (positional.length > 0) options.target = positional[0];
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await runOnboard(options.target, options);
    console.log(
      JSON.stringify(
        {
          target: result.target,
          outDir: result.outDir,
          files: result.files.map((file) => path.relative(result.target, file)),
          pack: result.pack,
          signals: {
            guidanceFiles: result.signals.guidanceFiles,
            commands: result.signals.commands,
            ecosystems: result.signals.ecosystems.map((eco) => eco.name),
            hotPaths: result.signals.hotPaths,
            commitCount: result.signals.commitCount,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`solvelang-onboard: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

if (require.main === module) {
  void main();
}
