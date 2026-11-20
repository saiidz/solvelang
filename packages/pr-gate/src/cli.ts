#!/usr/bin/env node
// SolveLang PR Gate — CI-runnable CLI.
//
// Given a checkout and a pull request's changed-file list, this tool:
//   1. builds the Solve Graph with the repository's own extractors
//      (site/app/solve-graph/core: inventory + JS/TS, PHP, Python imports),
//   2. verifies the graph's integrity and computes the blast radius with
//      analyzeSolveGraphImpact plus the engine's own impact explanations,
//   3. collects affected validations with createAffectedValidationCandidates,
//   4. builds a verified Solve Context pack with the MCP server's
//      buildWorkspaceContextPack, focused on the change + impact set,
//   5. evaluates the PR Gate policy file and emits report.md + result.json
//      (+ pack.json) and an exit code: 0 = no failing rule (or report-only
//      mode), 1 = a policy rule failed in enforce mode, 2 = operational
//      error (the run itself could not be completed).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ingestGitHubSnapshotEntries, type RepositorySnapshotEntry } from "../../../site/app/repository-audit/core/ingestion";
import { classifyRepositoryFile } from "../../../site/app/repository-audit/core/inventory";
import { extractRepositoryMultiLanguageDependencyGraph } from "../../../site/app/solve-graph/core/dependency-extractor";
import { serializeSolveGraphDocument, verifySolveGraphIntegrity } from "../../../site/app/solve-graph/core/canonical";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "../../../site/app/solve-graph/core/query-impact";
import { createSolveGraphImpactExplanation } from "../../../site/app/solve-graph/core/impact-explanation";
import { createAffectedValidationCandidates } from "../../../site/app/solve-graph/core/affected-validations";
import type { SolveGraphNode } from "../../../site/app/solve-graph/core/contracts";
import { buildWorkspaceContextPack } from "../../mcp-server/src/context-workspace";
import { loadPolicyFile, evaluatePolicy, parsePolicy, type PrGatePolicy } from "./policy";
import { renderReportMarkdown, type PrGateResult } from "./report";

export type PrGateMode = "report-only" | "enforce";

export type PrGateRunOptions = {
  root: string;
  changedPaths: string[];
  mode: PrGateMode;
  labels?: string[];
  task?: string;
  repo?: string;
  revision?: string;
  policyPath?: string;
  outDir: string;
  budgetBytes?: number;
  keepArtifacts?: boolean;
};

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".pr-gate", ".next", ".studio-test-dist"]);
const MAX_EXPLICIT_PACK_PATHS = 128; // mirrors MAX_CONTEXT_EXPLICIT_PATHS in the context engine
const MAX_WALK_BYTES_PER_FILE = 8 * 1024 * 1024;
// The context engine reads workspace files — and the graph document —
// through the MCP workspace reader, which refuses anything over 2 MB
// (packages/mcp-server/src/workspace.ts, MAX_FILE_BYTES). Oversize inputs
// are excluded up front and reported, instead of failing the whole run.
const PACK_FILE_MAX_BYTES = 2 * 1024 * 1024;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeChangedPath(value: string): string {
  return value.trim().replace(/^\.\//, "").split("\\").join("/");
}

// Mirrors isSensitivePath in packages/mcp-server/src/context-workspace.ts so
// the CLI never hands the pack builder a path it would refuse outright.
const SENSITIVE_DIRECTORIES = new Set([".aws", ".gnupg", ".kube", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json",
  "id_dsa", "id_ecdsa", "id_ed25519", "id_rsa", "secrets.json",
]);
export function isSensitiveContextPath(inputPath: string): boolean {
  const segments = inputPath.toLowerCase().split("/");
  const basename = segments[segments.length - 1];
  if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))) return true;
  if (SENSITIVE_FILENAMES.has(basename)) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  return basename.endsWith(".key") || basename.endsWith(".p12") || basename.endsWith(".pfx") || basename.endsWith(".pem");
}

async function walkCheckout(root: string, outDirAbsolute: string): Promise<{ entries: RepositorySnapshotEntry[]; fileHashes: Map<string, string> }> {
  const entries: RepositorySnapshotEntry[] = [];
  const fileHashes = new Map<string, string>();
  const pending: string[] = [root];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = toPosix(path.relative(root, absolute));
      if (child.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(child.name)) continue;
        if (absolute === outDirAbsolute) continue;
        pending.push(absolute);
        continue;
      }
      if (child.isSymbolicLink()) {
        entries.push({ path: relative, kind: "symlink" });
        continue;
      }
      if (!child.isFile()) continue;
      const stats = await lstat(absolute);
      if (stats.size > MAX_WALK_BYTES_PER_FILE) {
        entries.push({ path: relative, kind: "file", declaredByteSize: stats.size });
        continue;
      }
      const bytes = await readFile(absolute);
      fileHashes.set(relative, createHash("sha256").update(bytes).digest("hex"));
      entries.push({ path: relative, kind: "file", bytes: new Uint8Array(bytes) });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { entries, fileHashes };
}

function gitOutput(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function resolveRepoName(root: string, explicit: string | undefined): string {
  if (explicit) return explicit;
  const remote = gitOutput(root, ["remote", "get-url", "origin"]);
  const match = remote?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  return "local/pr-gate";
}

function resolveRevision(root: string, explicit: string | undefined, fileHashes: Map<string, string>): string {
  if (explicit) return explicit;
  const head = gitOutput(root, ["rev-parse", "HEAD"]);
  if (head && /^[a-f0-9]{40}$/i.test(head)) return head;
  const hash = createHash("sha256");
  for (const [filePath, fileHash] of [...fileHashes].sort()) hash.update(`${filePath}:${fileHash}\n`);
  return hash.digest("hex");
}

function nodeFilePath(node: SolveGraphNode): string | undefined {
  if (node.kind === "file" && node.identity.startsWith("file:")) return node.identity.slice("file:".length);
  return undefined;
}

function candidateFilePaths(node: SolveGraphNode): string[] {
  const paths = new Set<string>();
  for (const evidence of node.evidence) {
    if (evidence.path) paths.add(evidence.path);
  }
  if (paths.size === 0) {
    const filePath = nodeFilePath(node);
    if (filePath) paths.add(filePath);
  }
  return [...paths];
}

export async function runPrGate(options: PrGateRunOptions): Promise<{ exitCode: 0 | 1; result: PrGateResult }> {
  const root = path.resolve(options.root);
  const outDir = path.resolve(options.outDir);
  const changedPaths = [...new Set(options.changedPaths.map(normalizeChangedPath).filter(Boolean))].sort();
  const labels = options.labels ?? [];
  const stagingDir = path.join(root, ".pr-gate");
  const previousWorkspaceRoot = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    // 1. Ingest the checkout and build the Solve Graph with the repo's engines.
    const { entries, fileHashes } = await walkCheckout(root, outDir);
    const repo = resolveRepoName(root, options.repo);
    const revision = resolveRevision(root, options.revision, fileHashes);
    const { snapshot } = await ingestGitHubSnapshotEntries({ repositoryFullName: repo, commitSha: revision, entries });
    const document = await extractRepositoryMultiLanguageDependencyGraph(snapshot, { privateSource: true });
    const integrityVerified = await verifySolveGraphIntegrity(document);
    if (!integrityVerified) {
      throw new Error("Solve Graph integrity verification failed for the generated document.");
    }

    // Stage the canonical graph inside the workspace for the context engine.
    const graphSerialized = serializeSolveGraphDocument(document);
    const graphBytes = Buffer.byteLength(graphSerialized, "utf8");
    const graphInput: "provided" | "omitted-oversize" = graphBytes <= PACK_FILE_MAX_BYTES ? "provided" : "omitted-oversize";
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(stagingDir, "solve-graph.json"), graphSerialized, "utf8");

    // 2. Blast radius from the changed files.
    const index = await createSolveGraphQueryIndex(document);
    const fileNodeByPath = new Map<string, SolveGraphNode>();
    for (const node of document.nodes) {
      const filePath = nodeFilePath(node);
      if (filePath) fileNodeByPath.set(filePath, node);
    }
    const changedFiles = changedPaths.map((changedPath) => ({
      path: changedPath,
      mappedToGraphNode: fileNodeByPath.has(changedPath),
    }));
    const rootIds = changedPaths
      .map((changedPath) => fileNodeByPath.get(changedPath)?.id)
      .filter((id): id is string => typeof id === "string");

    let impactSection: PrGateResult["impact"];
    let affectedSection: PrGateResult["affectedValidations"];
    const impactedFileDepths = new Map<string, number>();
    if (rootIds.length === 0) {
      impactSection = {
        rootCount: 0,
        impactedNodes: 0,
        truncated: false,
        headline: "No changed files are present in the Solve Graph, so no blast radius could be computed.",
        rows: [],
        hiddenNodes: 0,
      };
      affectedSection = {
        graphValidationCandidates: 0,
        paths: [],
        touchedPaths: [],
        notice: "No impact traversal was run because no changed file is present in the Solve Graph.",
      };
    } else {
      const impact = analyzeSolveGraphImpact(index, rootIds);
      const explanation = createSolveGraphImpactExplanation(index, impact, { maxRows: 100 });
      const impactedIds = new Set<string>();
      for (const entry of impact.entries) {
        if (entry.depth < 1) continue;
        impactedIds.add(entry.id);
      }
      // The canonical set traversal marks every changed file as a root, so a
      // changed file that is downstream of another changed file never shows
      // up as "impacted" in it. For the pack focus and the validations view,
      // union the per-root traversals instead: there, a downstream changed
      // file is impacted by its sibling root exactly as a reviewer expects.
      const perRootCandidatePaths = new Set<string>();
      for (const rootId of rootIds) {
        const single = analyzeSolveGraphImpact(index, [rootId]);
        for (const entry of single.entries) {
          if (entry.depth < 1) continue;
          const node = index.nodesById.get(entry.id);
          const filePath = node ? nodeFilePath(node) : undefined;
          if (filePath) {
            const known = impactedFileDepths.get(filePath);
            if (known === undefined || entry.depth < known) impactedFileDepths.set(filePath, entry.depth);
          }
        }
        const singleValidations = createAffectedValidationCandidates(index, single);
        for (const candidate of singleValidations.candidates) {
          for (const candidatePath of candidateFilePaths(candidate.node)) perRootCandidatePaths.add(candidatePath);
        }
      }
      impactSection = {
        rootCount: rootIds.length,
        impactedNodes: impactedIds.size,
        truncated: impact.truncated,
        headline: explanation.headline,
        rows: explanation.rows.map((row) => ({
          label: row.node.label,
          kind: row.node.kind,
          depth: row.depth,
          sentence: row.sentence,
        })),
        hiddenNodes: explanation.summary.hiddenNodes,
      };
      const validations = createAffectedValidationCandidates(index, impact);
      const graphValidationPaths = [
        ...validations.candidates.flatMap((candidate) => candidateFilePaths(candidate.node)),
        ...perRootCandidatePaths,
      ];
      // The dependency pipeline's graph carries file nodes; the repository
      // inventory engine's own classifier is the second, equally
      // engine-grounded source of "validation" files inside the impact set.
      const testClassifiedPaths = [...impactedFileDepths.keys()].filter(
        (impactedPath) => classifyRepositoryFile({ path: impactedPath }) === "test",
      );
      const validationPaths = [...new Set([...graphValidationPaths, ...testClassifiedPaths])].sort();
      affectedSection = {
        graphValidationCandidates: validations.summary.matchedCandidates,
        paths: validationPaths,
        touchedPaths: validationPaths.filter((candidatePath) => changedPaths.includes(candidatePath)),
        notice: validations.notice,
      };
    }

    // 3. Verified context pack focused on the change + impact set. The pack
    // task names the changed and impacted files: the context engine ranks
    // sources by task relevance and graph hints, and naming the impact set
    // is what pulls deeper impacted files into the pack.
    const task = [
      options.task ?? "Review the pull request change set.",
      `Changed files: ${changedPaths.join(", ") || "(none)"}.`,
      impactedFileDepths.size > 0
        ? `Files impacted by the change (blast radius): ${[...impactedFileDepths.keys()].sort().join(", ")}.`
        : "",
    ].filter(Boolean).join(" ");
    const skippedSensitivePaths: string[] = [];
    const skippedMissingPaths: string[] = [];
    const skippedOversizePaths: string[] = [];
    const explicitCandidates: string[] = [];
    const seenCandidates = new Set<string>();
    const consider = (candidate: string) => {
      if (seenCandidates.has(candidate)) return;
      seenCandidates.add(candidate);
      if (isSensitiveContextPath(candidate)) {
        skippedSensitivePaths.push(candidate);
        return;
      }
      if (!existsSync(path.join(root, candidate))) {
        skippedMissingPaths.push(candidate);
        return;
      }
      if (statSync(path.join(root, candidate)).size > PACK_FILE_MAX_BYTES) {
        skippedOversizePaths.push(candidate);
        return;
      }
      explicitCandidates.push(candidate);
    };
    for (const changedPath of changedPaths) consider(changedPath);
    const impactedSorted = [...impactedFileDepths.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    for (const [impactedPath] of impactedSorted) consider(impactedPath);
    const explicitPaths = explicitCandidates.slice(0, MAX_EXPLICIT_PACK_PATHS);

    let packSection: PrGateResult["pack"] = null;
    await mkdir(outDir, { recursive: true });
    if (explicitPaths.length > 0) {
      const workspacePack = await buildWorkspaceContextPack(task, {
        paths: explicitPaths,
        changedPaths,
        ...(graphInput === "provided" ? { graphPath: ".pr-gate/solve-graph.json" } : {}),
        ...(options.budgetBytes ? { budgetBytes: options.budgetBytes } : {}),
      });
      await writeFile(path.join(outDir, "pack.json"), JSON.stringify(workspacePack, null, 2), "utf8");
      packSection = {
        packId: workspacePack.pack.packId,
        source: "explicit",
        entries: workspacePack.pack.entries.length,
        selectedBytes: workspacePack.pack.selectedBytes,
        budgetBytes: workspacePack.pack.budgetBytes,
        truncated: workspacePack.pack.truncated,
        omittedCandidates: workspacePack.pack.omittedCandidates,
        files: workspacePack.pack.entries.map((entry) => ({ path: entry.path, sourceSha256: entry.sourceSha256 })),
        skippedSensitivePaths,
        skippedMissingPaths,
        skippedOversizePaths,
        graphInput,
      };
    } else if (changedPaths.length > 0) {
      const workspacePack = await buildWorkspaceContextPack(task, {
        changedPaths,
        ...(graphInput === "provided" ? { graphPath: ".pr-gate/solve-graph.json" } : {}),
        ...(options.budgetBytes ? { budgetBytes: options.budgetBytes } : {}),
      });
      await writeFile(path.join(outDir, "pack.json"), JSON.stringify(workspacePack, null, 2), "utf8");
      packSection = {
        packId: workspacePack.pack.packId,
        source: "discovery",
        entries: workspacePack.pack.entries.length,
        selectedBytes: workspacePack.pack.selectedBytes,
        budgetBytes: workspacePack.pack.budgetBytes,
        truncated: workspacePack.pack.truncated,
        omittedCandidates: workspacePack.pack.omittedCandidates,
        files: workspacePack.pack.entries.map((entry) => ({ path: entry.path, sourceSha256: entry.sourceSha256 })),
        skippedSensitivePaths,
        skippedMissingPaths,
        skippedOversizePaths,
        graphInput,
      };
    }

    // 4. Policy evaluation.
    let policy: PrGatePolicy;
    let policySource: string;
    if (options.policyPath) {
      policy = await loadPolicyFile(path.resolve(options.policyPath));
      policySource = options.policyPath;
    } else if (existsSync(path.join(root, "pr-gate.policy.json"))) {
      policy = await loadPolicyFile(path.join(root, "pr-gate.policy.json"));
      policySource = "pr-gate.policy.json (repository default)";
    } else {
      policy = parsePolicy(JSON.stringify({ version: 1 }));
      policySource = "none (no policy file found; every rule skipped)";
    }
    const evaluation = evaluatePolicy(policy, {
      changedPaths,
      impactNodeCount: impactSection.impactedNodes,
      affectedValidationPaths: affectedSection.paths,
      labels,
    });
    const exitCode: 0 | 1 = options.mode === "enforce" && !evaluation.passed ? 1 : 0;

    const result: PrGateResult = {
      schema: "solvelang.pr-gate.result.v1",
      mode: options.mode,
      repo,
      revision,
      task,
      labels,
      changedFiles,
      graph: {
        graphId: document.graphId,
        integrityVerified,
        nodes: document.nodes.length,
        edges: document.edges.length,
        executionStatus: document.execution.status,
        truncated: document.execution.truncated,
        truncationReasons: [...document.execution.truncationReasons],
        serializedBytes: graphBytes,
      },
      impact: impactSection,
      affectedValidations: affectedSection,
      pack: packSection,
      policy: { source: policySource, evaluation },
      exitCode,
    };
    await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    await writeFile(path.join(outDir, "report.md"), renderReportMarkdown(result), "utf8");
    return { exitCode, result };
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (!options.keepArtifacts) {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
}

// --- CLI entry point ---------------------------------------------------------

type ParsedArgs = PrGateRunOptions & { help: boolean };

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    root: process.cwd(),
    changedPaths: [],
    mode: "report-only",
    labels: [],
    outDir: "pr-gate-out",
    help: false,
  };
  const changed: string[] = [];
  let changedFile: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}.`);
      return argv[i];
    };
    switch (arg) {
      case "--help": case "-h": parsed.help = true; break;
      case "--root": parsed.root = next(); break;
      case "--changed": changed.push(...next().split(",")); break;
      case "--changed-file": changedFile = next(); break;
      case "--mode": {
        const value = next();
        if (value !== "report-only" && value !== "enforce") throw new Error(`--mode must be report-only or enforce (got ${value}).`);
        parsed.mode = value;
        break;
      }
      case "--labels": parsed.labels = next().split(",").map((label) => label.trim()).filter(Boolean); break;
      case "--task": parsed.task = next(); break;
      case "--repo": parsed.repo = next(); break;
      case "--revision": parsed.revision = next(); break;
      case "--policy": parsed.policyPath = next(); break;
      case "--out": parsed.outDir = next(); break;
      case "--budget-bytes": parsed.budgetBytes = Number.parseInt(next(), 10); break;
      case "--keep-artifacts": parsed.keepArtifacts = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  parsed.changedPaths = changed;
  if (changedFile) {
    parsed.changedPaths = [...changed, ...readFileSync(changedFile, "utf8").split(/\r?\n/)];
  }
  return parsed;
}

const USAGE = `Usage: solvelang-pr-gate [options]

  --root <dir>          Checkout to analyze (default: current directory)
  --changed <a,b,c>     Comma-separated changed file paths
  --changed-file <path> File with one changed path per line
  --mode <mode>         report-only (default) or enforce
  --labels <a,b>        Pull request labels (for policy overrides)
  --task <text>         Context pack task (default: derived from the change set)
  --repo <owner/name>   Repository name for graph provenance
  --revision <sha>      Revision for graph provenance (default: git HEAD)
  --policy <path>       Policy file (default: <root>/pr-gate.policy.json if present)
  --out <dir>           Output directory for report.md / result.json / pack.json
  --budget-bytes <n>    Context pack budget (default: engine default)
  --keep-artifacts      Keep the staged .pr-gate/solve-graph.json in the checkout

Exit codes: 0 = no failing policy rule (always in report-only mode),
1 = policy failure in enforce mode, 2 = operational error.`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const { exitCode, result } = await runPrGate(parsed);
  console.log(`pr-gate: ${result.policy.evaluation.passed ? "PASS" : "FAIL"} (mode ${result.mode}, exit ${exitCode}) — report written to ${path.resolve(parsed.outDir)}`);
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`pr-gate: operational error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
