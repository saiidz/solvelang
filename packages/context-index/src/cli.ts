#!/usr/bin/env node
// SolveLang Context Index — zero-config persistent semantic context
// indexing for large repositories (Phase 7).
//
//   solvelang-context-index build   [root] [--out <dir>]
//   solvelang-context-index refresh [root] [--out <dir>] [--changed a.ts,b.ts]
//   solvelang-context-index status  [root] [--out <dir>]
//   solvelang-context-index query   [root] --task "..." [--budget-bytes <n>]
//
// build walks the workspace once — no caller planning, no task string —
// and writes the persistent index described in index-format.ts under
// .solve/. refresh detects changes by content hash and recomputes only
// the affected entries (changed files + their graph dependents). query
// answers a task from the index through the MCP server's own query core
// (packages/mcp-server/src/context-index.ts), the same code the local
// stdio tools solvelang_context_index_query / _status serve.
//
// Ranking is lexical + graph-structure (path/content-term scoring,
// declaration identifier overlap, one-hop graph neighborhood). There are
// no embeddings, no model calls, and no network access. Exit codes
// follow the PR Gate / Onboard convention: 0 = done, 2 = operational
// error.

import path from "node:path";

import { contextIndexStatus, queryContextIndex } from "../../mcp-server/src/context-index";
import { buildContextIndex, refreshContextIndex } from "./index-build";

interface CliOptions {
  command: string;
  root: string;
  outDir?: string;
  task?: string;
  budgetBytes?: number;
  changedPaths?: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: "", root: "." };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") options.outDir = argv[++i];
    else if (arg === "--task") options.task = argv[++i];
    else if (arg === "--budget-bytes") options.budgetBytes = Number.parseInt(argv[++i], 10);
    else if (arg === "--changed") options.changedPaths = (argv[++i] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: solvelang-context-index <build|refresh|status|query> [root] [--out <dir>] [--task \"...\"] [--budget-bytes <n>] [--changed a,b,c]");
      process.exit(0);
    } else positional.push(arg);
  }
  if (positional.length > 0) options.command = positional[0];
  if (positional.length > 1) options.root = positional[1];
  return options;
}

/** The MCP query core roots itself at SOLVELANG_WORKSPACE_ROOT, like the pack machinery. */
async function withWorkspaceRoot<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const outDir = options.outDir ? path.resolve(options.outDir) : undefined;

  if (options.command === "build") {
    const report = await buildContextIndex(root, { outDir });
    console.log(JSON.stringify({
      command: "build",
      root,
      outDir: report.outDir,
      source: report.index.source,
      graph: { ...report.index.graph, bytes: report.graphBytes },
      counts: report.index.counts,
      indexBytes: report.indexBytes,
      indexSha256: report.index.indexSha256,
      timingsMs: report.timingsMs,
    }, null, 2));
    return;
  }

  if (options.command === "refresh") {
    const report = await refreshContextIndex(root, { outDir, changedPaths: options.changedPaths });
    console.log(JSON.stringify({
      command: "refresh",
      root,
      outDir: report.outDir,
      changed: report.changed,
      addedPaths: report.addedPaths,
      modifiedPaths: report.modifiedPaths,
      deletedPaths: report.deletedPaths,
      affectedPaths: report.affectedPaths,
      recomputedRecordPaths: report.recomputedRecordPaths,
      edgeShiftedPaths: report.edgeShiftedPaths,
      carriedRecords: report.carriedRecords,
      impactFallback: report.impactFallback,
      counts: report.index.counts,
      indexSha256: report.index.indexSha256,
      timingsMs: report.timingsMs,
    }, null, 2));
    return;
  }

  if (options.command === "status") {
    const status = await withWorkspaceRoot(root, () => contextIndexStatus());
    console.log(JSON.stringify({ command: "status", root, ...status }, null, 2));
    return;
  }

  if (options.command === "query") {
    if (!options.task) throw new Error("query requires --task \"...\".");
    const result = await withWorkspaceRoot(root, () => queryContextIndex(options.task!, {
      ...(options.budgetBytes ? { budgetBytes: options.budgetBytes } : {}),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command "${options.command}". Expected build, refresh, status, or query.`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`solvelang-context-index: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
}
