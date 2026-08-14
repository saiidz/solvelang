import { normalizeRepositoryPath } from "./inventory";

export type ReferenceFileInput = {
  path: string;
  text?: string;
};

export type ModuleReference = {
  from: string;
  specifier: string;
  kind: "relative" | "package" | "builtin";
  resolvedPath?: string;
  packageName?: string;
};

export type ReferenceCandidate = {
  id: string;
  category: "missing-relative-import" | "unused-dependency" | "undeclared-package" | "lockfile-conflict";
  severity: "low" | "medium";
  confidence: "low" | "medium" | "high";
  title: string;
  explanation: string;
  evidence: string[];
  validation: string[];
};

export type ReferenceAnalysis = {
  schema: "solvelang.repository-audit.references.v1";
  mode: "analyze-only";
  references: ModuleReference[];
  candidates: ReferenceCandidate[];
  limitations: string[];
};

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "timers", "tls", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);
const MAX_ANALYZED_TEXT = 1024 * 1024;

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function normalizeJoined(base: string, relative: string): string | undefined {
  const segments = [...(base ? base.split("/") : []), ...relative.split("/")];
  const output: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (output.length === 0) return undefined;
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.length > 0 ? output.join("/") : undefined;
}

function candidatePaths(from: string, specifier: string): string[] {
  const joined = normalizeJoined(dirname(from), specifier);
  if (!joined) return [];
  const candidates = [joined];
  if (!JS_TS_EXTENSIONS.some((extension) => joined.endsWith(extension))) {
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${joined}${extension}`);
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${joined}/index${extension}`);
  }
  return candidates;
}

function rootPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0];
}

function classifySpecifier(specifier: string): Pick<ModuleReference, "kind" | "packageName"> {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return { kind: "relative" };
  const withoutNodePrefix = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (specifier.startsWith("node:") || NODE_BUILTINS.has(rootPackageName(withoutNodePrefix))) return { kind: "builtin" };
  return { kind: "package", packageName: rootPackageName(specifier) };
}

function extractStaticSpecifiers(text: string): string[] {
  const values = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'\n;]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const specifier = match[1]?.trim();
      if (specifier) values.add(specifier);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return [...values].sort();
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function declaredDependencies(packageJsonText: string | undefined): Set<string> {
  if (!packageJsonText || packageJsonText.length > MAX_ANALYZED_TEXT) return new Set();
  try {
    const parsed = JSON.parse(packageJsonText) as Record<string, unknown>;
    return new Set(Object.keys({
      ...stringRecord(parsed.dependencies),
      ...stringRecord(parsed.devDependencies),
      ...stringRecord(parsed.peerDependencies),
      ...stringRecord(parsed.optionalDependencies),
    }));
  } catch {
    return new Set();
  }
}

function candidate(
  category: ReferenceCandidate["category"],
  severity: ReferenceCandidate["severity"],
  confidence: ReferenceCandidate["confidence"],
  title: string,
  explanation: string,
  evidence: string[],
  validation: string[],
): ReferenceCandidate {
  const identity = `${category}:${evidence.join("|")}`;
  return { id: `rar_${stableId(identity)}`, category, severity, confidence, title, explanation, evidence, validation };
}

export function analyzeRepositoryReferences(files: ReferenceFileInput[]): ReferenceAnalysis {
  const normalized = files.map((file) => ({
    path: normalizeRepositoryPath(file.path),
    text: typeof file.text === "string" && file.text.length <= MAX_ANALYZED_TEXT ? file.text : undefined,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const paths = new Set(normalized.map((file) => file.path));
  const references: ModuleReference[] = [];
  const candidates: ReferenceCandidate[] = [];
  const usedPackages = new Set<string>();

  for (const file of normalized) {
    if (!file.text) continue;
    for (const specifier of extractStaticSpecifiers(file.text)) {
      const classification = classifySpecifier(specifier);
      if (classification.kind === "relative") {
        const resolvedPath = candidatePaths(file.path, specifier).find((candidatePath) => paths.has(candidatePath));
        references.push({ from: file.path, specifier, kind: "relative", ...(resolvedPath ? { resolvedPath } : {}) });
        if (!resolvedPath) {
          candidates.push(candidate(
            "missing-relative-import",
            "medium",
            "high",
            "Relative import does not resolve inside the snapshot",
            `${file.path} statically references ${specifier}, but no supported file or index candidate exists in the repository snapshot.`,
            [file.path, specifier],
            ["Confirm the import is not generated at build time.", "Check whether repository ingestion omitted the referenced path."],
          ));
        }
        continue;
      }
      if (classification.kind === "package" && classification.packageName) usedPackages.add(classification.packageName);
      references.push({ from: file.path, specifier, ...classification });
    }
  }

  const packageJson = normalized.find((file) => file.path === "package.json");
  const declared = declaredDependencies(packageJson?.text);
  for (const dependency of [...declared].sort()) {
    if (usedPackages.has(dependency)) continue;
    candidates.push(candidate(
      "unused-dependency",
      "low",
      "low",
      "Declared package has no static import reference",
      `${dependency} is declared in the root package manifest but was not found in supported static import/require syntax.`,
      ["package.json", dependency],
      ["Search build scripts, framework configuration, plugins, CLI usage, generated code, and dynamic imports before removal."],
    ));
  }
  for (const dependency of [...usedPackages].sort()) {
    if (declared.has(dependency)) continue;
    candidates.push(candidate(
      "undeclared-package",
      "medium",
      "medium",
      "Package import is not declared in the root manifest",
      `${dependency} is referenced by static module syntax but is not declared in root dependencies, devDependencies, peerDependencies, or optionalDependencies.`,
      [dependency],
      ["Check workspace/package-level manifests and package-manager overrides before adding a dependency."],
    ));
  }

  const lockfiles = LOCKFILES.filter((path) => paths.has(path));
  if (lockfiles.length > 1) {
    candidates.push(candidate(
      "lockfile-conflict",
      "medium",
      "high",
      "Multiple JavaScript package-manager lockfiles detected",
      `The repository root contains ${lockfiles.join(", ")}. Multiple lockfiles can make local and CI dependency resolution diverge.`,
      lockfiles,
      ["Confirm the authoritative package manager before removing any lockfile.", "Run install and build validation on a dedicated cleanup branch."],
    ));
  }

  references.sort((left, right) => left.from.localeCompare(right.from) || left.specifier.localeCompare(right.specifier));
  candidates.sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));

  return {
    schema: "solvelang.repository-audit.references.v1",
    mode: "analyze-only",
    references,
    candidates,
    limitations: [
      "Static import detection does not execute repository code and intentionally ignores non-literal dynamic imports.",
      "Unused dependency findings are low-confidence candidates because packages may be consumed by configuration, plugins, CLIs, code generation, or workspace packages.",
      "Relative resolution covers common JavaScript/TypeScript file and index extensions but does not evaluate tsconfig path aliases or framework-specific resolvers.",
      "Root dependency comparison does not replace package-level analysis in monorepos.",
    ],
  };
}
