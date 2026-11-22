// Signal extraction for solvelang-onboard.
//
// Conservative by design: every extracted fact carries the source it came
// from (file + line, manifest key, git history, or layout marker), and
// anything not evidenced is omitted rather than inferred. The inference
// report renders these attributions verbatim, so a reader can check every
// generated block against the signal that produced it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { classifyRepositoryFile } from "../../../site/app/repository-audit/core/inventory";

export type CommandKind = "test" | "build" | "lint" | "run";

export interface CommandFact {
  kind: CommandKind;
  command: string;
  source: string; // e.g. "AGENTS.md:14" or "package.json:scripts.test"
}

export interface EcosystemFact {
  name: string;
  source: string; // marker file, repo-relative
}

export interface HotPath {
  path: string;
  changes: number;
}

export interface RepoSignals {
  root: string;
  guidanceFiles: string[];
  commands: CommandFact[];
  ecosystems: EcosystemFact[];
  languages: { language: string; files: number }[];
  hotPaths: HotPath[];
  commitSubjects: string[];
  commitCount: number | null;
  fileCount: number;
  testFileCount: number;
  notes: string[];
}

// Explicit caps, stated in the README and the generated report.
export const MAX_LAYOUT_ENTRIES = 4000;
export const MAX_LAYOUT_DEPTH = 12;
export const MAX_HISTORY_COMMITS = 50;
export const MAX_HOT_PATHS = 8;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  ".solve",
  "vendor",
  ".next",
  "coverage",
  ".venv",
  "__pycache__",
]);

const COMMAND_STARTERS =
  /^(npm|npx|yarn|pnpm|bun|cargo|pytest|python3?|make|go|mvn|gradle|composer|php|node|deno)\b/;

function classifyCommandKind(context: string, command: string): CommandKind | null {
  const hay = `${context} ${command}`.toLowerCase();
  if (/\btest(s|ing)?\b/.test(hay)) return "test";
  if (/\bbuild\b/.test(hay)) return "build";
  if (/\blint\b/.test(hay)) return "lint";
  if (/\b(run|dev|start|serve)\b/.test(hay)) return "run";
  return null;
}

function extractGuidanceCommands(filePath: string, rel: string, out: CommandFact[]): void {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  let heading = "";
  lines.forEach((line, index) => {
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) heading = headingMatch[1];
    const source = `${rel}:${index + 1}`;
    const spans = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
    for (const span of spans) {
      if (!COMMAND_STARTERS.test(span)) continue;
      const kind = classifyCommandKind(`${heading} ${line}`, span);
      if (kind) out.push({ kind, command: span, source });
    }
    const labelled = line.match(
      /\b(test|build|lint|run)\s+command\s*[:\-]\s*`?([^\n`]+)`?/i,
    );
    if (labelled) {
      const command = labelled[2].trim();
      if (COMMAND_STARTERS.test(command)) {
        out.push({ kind: labelled[1].toLowerCase() as CommandKind, command, source });
      }
    }
  });
}

function extractPackageJsonCommands(root: string, out: CommandFact[]): void {
  const manifestPath = path.join(root, "package.json");
  if (!existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const kindByScript: Record<string, CommandKind> = {
      test: "test",
      build: "build",
      lint: "lint",
      start: "run",
      dev: "run",
    };
    for (const [script, kind] of Object.entries(kindByScript)) {
      const body = manifest.scripts?.[script];
      if (body) {
        out.push({
          kind,
          command: script === "test" ? `npm test` : `npm run ${script}`,
          source: `package.json:scripts.${script}`,
        });
      }
    }
  } catch {
    // A malformed package.json is a layout fact, not a command source.
  }
}

const ECOSYSTEM_MARKERS: { file: string; name: string }[] = [
  { file: "package.json", name: "Node.js" },
  { file: "pyproject.toml", name: "Python" },
  { file: "requirements.txt", name: "Python" },
  { file: "setup.py", name: "Python" },
  { file: "Cargo.toml", name: "Rust" },
  { file: "composer.json", name: "PHP" },
  { file: "go.mod", name: "Go" },
  { file: "pom.xml", name: "JVM (Maven)" },
  { file: "build.gradle", name: "JVM (Gradle)" },
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".php": "PHP",
  ".go": "Go",
  ".rb": "Ruby",
  ".java": "Java",
  ".md": "Markdown",
  ".solve": "SolveLang",
};

function scanLayout(
  root: string,
): Pick<RepoSignals, "ecosystems" | "languages" | "fileCount" | "testFileCount"> {
  const ecosystems: EcosystemFact[] = [];
  const seenEcosystems = new Set<string>();
  for (const marker of ECOSYSTEM_MARKERS) {
    if (existsSync(path.join(root, marker.file)) && !seenEcosystems.has(marker.name)) {
      seenEcosystems.add(marker.name);
      ecosystems.push({ name: marker.name, source: marker.file });
    }
  }
  const languageCounts = new Map<string, number>();
  let fileCount = 0;
  let testFileCount = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_LAYOUT_DEPTH || fileCount >= MAX_LAYOUT_ENTRIES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (fileCount >= MAX_LAYOUT_ENTRIES) return;
      const full = path.join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full, depth + 1);
      } else if (stats.isFile()) {
        fileCount += 1;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (classifyRepositoryFile({ path: rel, generated: false }) === "test") {
          testFileCount += 1;
        }
        const language = LANGUAGE_BY_EXTENSION[path.extname(entry).toLowerCase()];
        if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      }
    }
  };
  walk(root, 0);
  const languages = [...languageCounts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
  return { ecosystems, languages, fileCount, testFileCount };
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    });
  } catch {
    return null;
  }
}

function extractHistory(
  root: string,
  notes: string[],
): Pick<RepoSignals, "hotPaths" | "commitSubjects" | "commitCount"> {
  if (git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") {
    notes.push("Not a git repository (or git unavailable) — history signals unavailable.");
    return { hotPaths: [], commitSubjects: [], commitCount: null };
  }
  const countRaw = git(root, ["rev-list", "--count", "HEAD"]);
  const commitCount = countRaw ? Number.parseInt(countRaw.trim(), 10) || 0 : null;
  if (commitCount === 0 || commitCount === null) {
    notes.push("Git repository has no commits yet — history signals unavailable.");
    return { hotPaths: [], commitSubjects: [], commitCount };
  }
  const subjects = (git(root, ["log", "--format=%s", `-n`, String(MAX_HISTORY_COMMITS)]) ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const nameOnly = git(root, [
    "log",
    "--name-only",
    "--format=",
    `-n`,
    String(MAX_HISTORY_COMMITS),
  ]);
  const frequencies = new Map<string, number>();
  for (const line of (nameOnly ?? "").split(/\r?\n/)) {
    const entry = line.trim();
    if (entry) frequencies.set(entry, (frequencies.get(entry) ?? 0) + 1);
  }
  const hotPaths = [...frequencies.entries()]
    .filter(([, changes]) => changes >= 2)
    .map(([pathEntry, changes]) => ({ path: pathEntry, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, MAX_HOT_PATHS);
  return { hotPaths, commitSubjects: subjects, commitCount };
}

export function extractSignals(root: string): RepoSignals {
  const notes: string[] = [];
  const commands: CommandFact[] = [];
  const guidanceFiles: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const full = path.join(root, name);
    if (existsSync(full)) {
      guidanceFiles.push(name);
      extractGuidanceCommands(full, name, commands);
    }
  }
  if (guidanceFiles.length === 0) {
    notes.push("No AGENTS.md or CLAUDE.md at the repository root — guidance signals unavailable.");
  }
  extractPackageJsonCommands(root, commands);
  const deduped = new Map<string, CommandFact>();
  for (const fact of commands) {
    const key = `${fact.kind}:${fact.command}`;
    if (!deduped.has(key)) deduped.set(key, fact);
  }
  const layout = scanLayout(root);
  const history = extractHistory(root, notes);
  return {
    root,
    guidanceFiles,
    commands: [...deduped.values()],
    ...layout,
    ...history,
    notes,
  };
}
