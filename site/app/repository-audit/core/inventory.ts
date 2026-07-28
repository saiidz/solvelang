export type RepositoryFileClass =
  | "source"
  | "test"
  | "documentation"
  | "configuration"
  | "generated"
  | "vendor"
  | "asset"
  | "archive"
  | "backup"
  | "unknown";

export type RepositorySeverity = "critical" | "high" | "medium" | "low" | "info";
export type RepositoryRecommendation = "keep" | "review" | "move" | "merge" | "rewrite" | "delete-candidate";

export type RepositoryFileInput = {
  path: string;
  byteSize: number;
  sha256?: string;
  text?: string;
  generated?: boolean;
};

export type RepositorySnapshot = {
  source: {
    kind: "github" | "archive";
    displayName: string;
    revision: string;
    fingerprint: string;
  };
  files: RepositoryFileInput[];
};

export type RepositoryScanLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
  maxFindings: number;
  maxManifestTextBytes: number;
  largeFileThresholdBytes: number;
};

export type RepositoryEvidence = {
  path: string;
  kind: "file" | "directory" | "manifest" | "config" | "generated-marker" | "size" | "hash" | "name-pattern" | "deployment";
  byteSize?: number;
  sha256?: string;
  note?: string;
};

export type RepositoryConfidence = {
  level: "low" | "medium" | "high";
  score: number;
  basis: string;
};

export type RepositoryDetection = {
  name: string;
  version?: string;
  confidence: RepositoryConfidence;
  evidence: RepositoryEvidence[];
};

export type RepositoryFinding = {
  id: string;
  ruleId: string;
  category: "duplication" | "backup-files" | "generated-files" | "large-files";
  severity: RepositorySeverity;
  title: string;
  recommendation: RepositoryRecommendation;
  explanation: string;
  confidence: RepositoryConfidence;
  impact: string;
  evidence: RepositoryEvidence[];
  destructive: boolean;
  approvalRequired: boolean;
  validation: string[];
  rollback: string[];
};

export type RepositoryInventoryAnalysis = {
  schema: "solvelang.repository-audit.inventory.v0";
  mode: "analyze-only";
  source: RepositorySnapshot["source"];
  limits: RepositoryScanLimits;
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: Array<"file-count" | "total-bytes" | "file-size" | "depth" | "finding-count">;
    networkAccess: false;
    writeAccess: false;
  };
  summary: {
    filesSeen: number;
    filesScanned: number;
    filesSkipped: number;
    bytesScanned: number;
    directoriesSeen: number;
  };
  inventory: {
    fileClasses: Array<{ class: RepositoryFileClass; count: number }>;
    languages: RepositoryDetection[];
    frameworks: RepositoryDetection[];
    packageManagers: RepositoryDetection[];
    deploymentTargets: RepositoryDetection[];
    largeFiles: RepositoryEvidence[];
  };
  detections: {
    duplicates: Array<{
      groupId: string;
      matchType: "exact-content";
      confidence: RepositoryConfidence;
      members: RepositoryEvidence[];
    }>;
    backupCandidates: RepositoryEvidence[];
    generatedCandidates: RepositoryEvidence[];
  };
  findings: RepositoryFinding[];
};

export const defaultRepositoryScanLimits: RepositoryScanLimits = Object.freeze({
  maxFiles: 50_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxFindings: 5_000,
  maxManifestTextBytes: 1024 * 1024,
  largeFileThresholdBytes: 5 * 1024 * 1024,
});

const fileClassOrder: RepositoryFileClass[] = [
  "source",
  "test",
  "documentation",
  "configuration",
  "generated",
  "vendor",
  "asset",
  "archive",
  "backup",
  "unknown",
];

const severityOrder: Record<RepositorySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const sourceExtensions = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "kt", "kts", "mjs", "cjs",
  "php", "py", "rb", "rs", "scss", "sh", "sql", "swift", "ts", "tsx", "vue", "svelte",
]);
const assetExtensions = new Set(["avif", "bmp", "eot", "gif", "ico", "jpeg", "jpg", "mp3", "mp4", "ogg", "otf", "pdf", "png", "svg", "ttf", "wav", "webm", "webp", "woff", "woff2"]);
const archiveExtensions = [".7z", ".bz2", ".gz", ".rar", ".tar", ".tar.gz", ".tgz", ".xz", ".zip"];
const configurationNames = new Set([
  ".dockerignore", ".editorconfig", ".env.example", ".gitattributes", ".gitignore", ".npmrc", ".prettierrc", "cargo.toml",
  "composer.json", "dockerfile", "go.mod", "go.sum", "makefile", "package-lock.json", "package.json", "pnpm-lock.yaml",
  "poetry.lock", "pyproject.toml", "requirements.txt", "rust-toolchain.toml", "tsconfig.json", "vercel.json", "wrangler.toml", "yarn.lock",
]);

type TruncationReason = RepositoryInventoryAnalysis["execution"]["truncationReasons"][number];
type NormalizedFile = RepositoryFileInput & { path: string; class: RepositoryFileClass };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertFiniteNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

export function normalizeRepositoryPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error("Repository paths must be non-empty strings.");
  if (input.includes("\0")) throw new Error("Repository paths cannot contain NUL bytes.");
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new Error(`Repository path must be relative: ${input}`);
  if (input.includes("\\")) throw new Error(`Repository path must use POSIX separators: ${input}`);
  const normalized: string[] = [];
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") throw new Error(`Repository path cannot traverse outside the snapshot: ${input}`);
    normalized.push(segment);
  }
  if (normalized.length === 0) throw new Error("Repository paths must identify a file.");
  return normalized.join("/");
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function isBackupPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return /(?:\.bak|\.backup|\.old|\.orig|\.save|\.copy|~)$/.test(name)
    || /(?:^|[._ -])copy(?:[._ -]?\d+)?(?:\.[^.]+)?$/.test(name)
    || /(?:^|[._ -])backup(?:[._ -]?\d+)?(?:\.[^.]+)?$/.test(name);
}

function isVendorPath(path: string): boolean {
  return path.toLowerCase().split("/").some((segment) => ["node_modules", "vendor", ".venv", "venv", "pods"].includes(segment));
}

function isGeneratedPath(path: string, explicit = false): boolean {
  if (explicit) return true;
  const lower = path.toLowerCase();
  if (lower.split("/").some((segment) => [".next", "coverage", "dist", "generated", "out", "target"].includes(segment))) return true;
  return /(?:\.generated\.[^.]+|\.min\.(?:css|js)|\.map)$/.test(lower);
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)/.test(lower) || /\.(?:test|spec)\.[^.]+$/.test(lower);
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  return /(?:^|\/)docs?(?:\/|$)/.test(lower)
    || /^(?:readme|license|licence|changelog|contributing|security)(?:\.|$)/.test(name)
    || ["md", "mdx", "rst", "adoc"].includes(extension(lower));
}

function isConfigurationPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  return configurationNames.has(name)
    || /^tsconfig(?:\.[^.]+)?\.json$/.test(name)
    || /^next\.config\./.test(name)
    || /^vite\.config\./.test(name)
    || /^eslint\.config\./.test(name)
    || ["ini", "toml", "yaml", "yml"].includes(extension(lower))
    || /(?:^|\/)\.github\/workflows\/.+\.ya?ml$/.test(lower);
}

export function classifyRepositoryFile(file: Pick<RepositoryFileInput, "path" | "generated">): RepositoryFileClass {
  const path = normalizeRepositoryPath(file.path);
  const lower = path.toLowerCase();
  if (isBackupPath(path)) return "backup";
  if (isVendorPath(path)) return "vendor";
  if (isGeneratedPath(path, file.generated)) return "generated";
  if (isTestPath(path)) return "test";
  if (isDocumentationPath(path)) return "documentation";
  if (isConfigurationPath(path)) return "configuration";
  if (archiveExtensions.some((suffix) => lower.endsWith(suffix))) return "archive";
  if (assetExtensions.has(extension(path))) return "asset";
  if (sourceExtensions.has(extension(path))) return "source";
  return "unknown";
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul((left ^ code) >>> 0, 0x01000193) >>> 0;
    right = Math.imul((right ^ ((code + index) >>> 0)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

function confidence(level: RepositoryConfidence["level"], score: number, basis: string): RepositoryConfidence {
  return { level, score, basis };
}

function evidence(path: string, kind: RepositoryEvidence["kind"], file?: { byteSize?: number; sha256?: string }, note?: string): RepositoryEvidence {
  return {
    path,
    kind,
    ...(file?.byteSize === undefined ? {} : { byteSize: file.byteSize }),
    ...(file?.sha256 ? { sha256: file.sha256 } : {}),
    ...(note ? { note } : {}),
  };
}

function boundedText(file: NormalizedFile | undefined, maxTextBytes: number): string | undefined {
  if (!file?.text || file.byteSize > maxTextBytes || file.text.length > maxTextBytes) return undefined;
  return file.text;
}

function parsePackageJson(file: NormalizedFile | undefined, maxTextBytes: number): Record<string, unknown> | undefined {
  const text = boundedText(file, maxTextBytes);
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (typeof item === "string") result[key] = item;
  return result;
}

function packageDependencies(manifest: Record<string, unknown> | undefined): Record<string, string> {
  return {
    ...stringMap(manifest?.dependencies),
    ...stringMap(manifest?.devDependencies),
    ...stringMap(manifest?.peerDependencies),
  };
}

function languageDetections(files: NormalizedFile[]): RepositoryDetection[] {
  const definitions: Array<[string, Set<string>]> = [
    ["TypeScript", new Set(["ts", "tsx"])], ["JavaScript", new Set(["js", "jsx", "mjs", "cjs"])], ["Rust", new Set(["rs"])],
    ["Python", new Set(["py"])], ["PHP", new Set(["php"])], ["Go", new Set(["go"])], ["Ruby", new Set(["rb"])],
    ["Java", new Set(["java"])], ["Kotlin", new Set(["kt", "kts"])], ["C#", new Set(["cs"])],
    ["C/C++", new Set(["c", "cc", "cpp", "h", "hpp"])], ["Swift", new Set(["swift"])],
    ["Shell", new Set(["sh"])], ["SQL", new Set(["sql"])], ["HTML", new Set(["html"])], ["CSS", new Set(["css", "scss"])],
  ];
  const detections: RepositoryDetection[] = [];
  for (const [name, extensions] of definitions) {
    const matches = files.filter((file) => extensions.has(extension(file.path)) && !["vendor", "generated"].includes(file.class));
    if (matches.length === 0) continue;
    detections.push({
      name,
      confidence: confidence("high", 0.99, `${matches.length} repository file${matches.length === 1 ? "" : "s"} use recognized ${name} extensions.`),
      evidence: matches.slice(0, 3).map((file) => evidence(file.path, "file")),
    });
  }
  return detections.sort((left, right) => compareText(left.name, right.name));
}

function frameworkDetections(files: NormalizedFile[], maxTextBytes: number): RepositoryDetection[] {
  const byPath = new Map(files.map((file): [string, NormalizedFile] => [file.path.toLowerCase(), file]));
  const packageFile = byPath.get("package.json");
  const dependencies = packageDependencies(parsePackageJson(packageFile, maxTextBytes));
  const detections: RepositoryDetection[] = [];
  const addPackageFramework = (dependency: string, name: string) => {
    if (!(dependency in dependencies) || !packageFile) return;
    detections.push({
      name,
      version: dependencies[dependency],
      confidence: confidence("high", 0.99, `${dependency} is declared in package.json.`),
      evidence: [evidence(packageFile.path, "manifest")],
    });
  };
  addPackageFramework("next", "Next.js");
  addPackageFramework("react", "React");
  addPackageFramework("vue", "Vue");
  addPackageFramework("svelte", "Svelte");
  addPackageFramework("@angular/core", "Angular");
  addPackageFramework("express", "Express");
  addPackageFramework("fastify", "Fastify");

  const composer = byPath.get("composer.json");
  if (boundedText(composer, maxTextBytes)?.includes("laravel/framework")) {
    detections.push({ name: "Laravel", confidence: confidence("high", 0.98, "laravel/framework is declared in composer.json."), evidence: [evidence(composer!.path, "manifest")] });
  }
  const cargo = byPath.get("cargo.toml");
  if (cargo) detections.push({ name: "Rust/Cargo", confidence: confidence("high", 1, "Cargo.toml is present."), evidence: [evidence(cargo.path, "manifest")] });
  const goModule = byPath.get("go.mod");
  if (goModule) detections.push({ name: "Go modules", confidence: confidence("high", 1, "go.mod is present."), evidence: [evidence(goModule.path, "manifest")] });
  const managePy = files.find((file) => /^manage\.py$/i.test(file.path));
  const djangoReference = files.some((file) => boundedText(file, maxTextBytes)?.toLowerCase().includes("django"));
  if (managePy && djangoReference) {
    detections.push({ name: "Django", confidence: confidence("medium", 0.8, "manage.py and a bounded Django reference are present."), evidence: [evidence(managePy.path, "file")] });
  }
  return detections.sort((left, right) => compareText(left.name, right.name));
}

function packageManagerDetections(files: NormalizedFile[]): RepositoryDetection[] {
  const definitions: Array<[string, string[]]> = [
    ["npm", ["package-lock.json"]], ["pnpm", ["pnpm-lock.yaml"]], ["Yarn", ["yarn.lock"]], ["Bun", ["bun.lock", "bun.lockb"]],
    ["Cargo", ["cargo.lock", "cargo.toml"]], ["Composer", ["composer.lock", "composer.json"]], ["Poetry", ["poetry.lock", "pyproject.toml"]],
    ["pip", ["requirements.txt"]], ["Go modules", ["go.mod", "go.sum"]],
  ];
  const lowerPaths = new Map(files.map((file): [string, NormalizedFile] => [file.path.toLowerCase(), file]));
  const results: RepositoryDetection[] = [];
  for (const [name, candidates] of definitions) {
    const matched = candidates.map((candidate) => lowerPaths.get(candidate)).filter((file): file is NormalizedFile => Boolean(file));
    if (matched.length === 0) continue;
    results.push({
      name,
      confidence: confidence("high", 1, `${matched.map((file) => file.path).join(" and ")} ${matched.length === 1 ? "is" : "are"} present.`),
      evidence: matched.map((file) => evidence(file.path, "manifest")),
    });
  }
  return results.sort((left, right) => compareText(left.name, right.name));
}

function deploymentDetections(files: NormalizedFile[], maxTextBytes: number): RepositoryDetection[] {
  const results: RepositoryDetection[] = [];
  const match = (name: string, predicate: (file: NormalizedFile) => boolean, basis: string) => {
    const matches = files.filter(predicate);
    if (matches.length > 0) results.push({ name, confidence: confidence("high", 0.98, basis), evidence: matches.slice(0, 3).map((file) => evidence(file.path, "deployment")) });
  };
  match("GitHub Actions", (file) => /^\.github\/workflows\/.+\.ya?ml$/i.test(file.path), "GitHub Actions workflow files are present.");
  match("Docker", (file) => /(?:^|\/)(?:dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(file.path), "Docker configuration is present.");
  match("Vercel", (file) => /(?:^|\/)vercel\.json$/i.test(file.path), "vercel.json is present.");
  match("Cloudflare Workers", (file) => /(?:^|\/)wrangler\.toml$/i.test(file.path), "wrangler.toml is present.");
  match("Netlify", (file) => /(?:^|\/)netlify\.toml$/i.test(file.path), "netlify.toml is present.");
  match("AWS Amplify", (file) => /(?:^|\/)amplify\.ya?ml$/i.test(file.path), "Amplify build configuration is present.");
  match("Kubernetes", (file) => /(?:^|\/)(?:k8s|kubernetes|charts?)(?:\/|$)/i.test(file.path), "Kubernetes or Helm paths are present.");
  match("AWS SAM", (file) => /(?:^|\/)(?:template|sam-template)\.ya?ml$/i.test(file.path) && Boolean(boundedText(file, maxTextBytes)?.includes("AWS::Serverless")), "An AWS SAM transform or resource is present.");
  return results.sort((left, right) => compareText(left.name, right.name));
}

function validateLimits(overrides: Partial<RepositoryScanLimits>): RepositoryScanLimits {
  const limits = { ...defaultRepositoryScanLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) assertPositiveInteger(value, name);
  if (limits.largeFileThresholdBytes > limits.maxFileBytes) throw new Error("largeFileThresholdBytes cannot exceed maxFileBytes.");
  return limits;
}

function validateSource(source: RepositorySnapshot["source"]): void {
  if (source.kind !== "github" && source.kind !== "archive") throw new Error("Repository source kind must be github or archive.");
  if (!source.displayName.trim()) throw new Error("Repository source displayName is required.");
  if (!source.revision.trim()) throw new Error("Repository source revision is required.");
  if (!/^sha256:[a-f0-9]{64}$/.test(source.fingerprint)) throw new Error("Repository source fingerprint must be a lowercase SHA-256 value.");
}

function normalizedFiles(snapshot: RepositorySnapshot): NormalizedFile[] {
  if (!Array.isArray(snapshot.files)) throw new Error("Repository snapshot files must be an array.");
  const seen = new Set<string>();
  return snapshot.files.map((file, index) => {
    const path = normalizeRepositoryPath(file.path);
    if (seen.has(path)) throw new Error(`Duplicate repository path: ${path}`);
    seen.add(path);
    assertFiniteNonNegativeInteger(file.byteSize, `files[${index}].byteSize`);
    if (file.sha256 && !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid SHA-256 for ${path}.`);
    if (file.text !== undefined && typeof file.text !== "string") throw new Error(`Invalid text content for ${path}.`);
    if (file.generated !== undefined && typeof file.generated !== "boolean") throw new Error(`Invalid generated flag for ${path}.`);
    return { ...file, path, class: classifyRepositoryFile({ path, generated: file.generated }) };
  }).sort((left, right) => compareText(left.path, right.path));
}

function capFindings(findings: RepositoryFinding[], limit: number, reasons: Set<TruncationReason>): RepositoryFinding[] {
  const sorted = findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || compareText(left.ruleId, right.ruleId)
    || compareText(left.evidence[0].path, right.evidence[0].path)
    || compareText(left.id, right.id));
  if (sorted.length > limit) reasons.add("finding-count");
  return sorted.slice(0, limit);
}

export function analyzeRepositoryInventory(snapshot: RepositorySnapshot, limitOverrides: Partial<RepositoryScanLimits> = {}): RepositoryInventoryAnalysis {
  validateSource(snapshot.source);
  const limits = validateLimits(limitOverrides);
  const allFiles = normalizedFiles(snapshot);
  const reasons = new Set<TruncationReason>();
  const accepted: NormalizedFile[] = [];
  let bytesScanned = 0;

  for (let index = 0; index < allFiles.length; index += 1) {
    const file = allFiles[index];
    if (index >= limits.maxFiles) {
      reasons.add("file-count");
      continue;
    }
    if (pathDepth(file.path) > limits.maxDepth) {
      reasons.add("depth");
      continue;
    }
    if (file.byteSize > limits.maxFileBytes) {
      reasons.add("file-size");
      continue;
    }
    if (bytesScanned + file.byteSize > limits.maxTotalBytes) {
      reasons.add("total-bytes");
      continue;
    }
    accepted.push(file);
    bytesScanned += file.byteSize;
  }

  const classCounts = new Map<RepositoryFileClass, number>(fileClassOrder.map((item): [RepositoryFileClass, number] => [item, 0]));
  for (const file of accepted) classCounts.set(file.class, (classCounts.get(file.class) ?? 0) + 1);

  const backupFiles = accepted.filter((file) => file.class === "backup");
  const generatedFiles = accepted.filter((file) => file.class === "generated");
  const largeFiles = accepted.filter((file) => file.byteSize >= limits.largeFileThresholdBytes);

  const hashGroups = new Map<string, NormalizedFile[]>();
  for (const file of accepted) {
    if (!file.sha256) continue;
    const group = hashGroups.get(file.sha256) ?? [];
    group.push(file);
    hashGroups.set(file.sha256, group);
  }
  const duplicateGroups = [...hashGroups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([sha256, members]) => {
      const sortedMembers = [...members].sort((left, right) => compareText(left.path, right.path));
      return {
        groupId: `dup_${stableHash(`${sha256}:${sortedMembers.map((file) => file.path).join("|")}`)}`,
        matchType: "exact-content" as const,
        confidence: confidence("high", 1, "Member files have identical SHA-256 digests."),
        members: sortedMembers.map((file) => evidence(file.path, "hash", { byteSize: file.byteSize, sha256 })),
      };
    })
    .sort((left, right) => compareText(left.members[0].path, right.members[0].path));

  const findings: RepositoryFinding[] = [];
  for (const group of duplicateGroups) {
    const backupMembers = group.members.filter((member) => isBackupPath(member.path));
    const activeMembers = group.members.filter((member) => !isBackupPath(member.path));
    if (backupMembers.length > 0 && activeMembers.length > 0) {
      for (const backup of backupMembers) {
        findings.push({
          id: `raf_${stableHash(`RA012:${backup.path}:${backup.sha256 ?? ""}`)}`,
          ruleId: "RA012",
          category: "backup-files",
          severity: "medium",
          title: "Tracked backup file duplicates an active file",
          recommendation: "delete-candidate",
          explanation: `${backup.path} is byte-for-byte identical to an active repository file. It is only a candidate for removal after reference and build validation.`,
          confidence: confidence("high", 1, "The backup naming pattern and exact SHA-256 match agree."),
          impact: "Duplicate backup files increase maintenance ambiguity and may preserve stale or accidentally deployed code.",
          evidence: [backup, ...activeMembers.slice(0, 3)],
          destructive: true,
          approvalRequired: true,
          validation: ["Search for direct references to the backup path.", "Run the repository's existing tests and build on a dedicated cleanup branch."],
          rollback: ["Restore the file from the dedicated cleanup branch commit if validation or review fails."],
        });
      }
      continue;
    }
    findings.push({
      id: `raf_${stableHash(`RA010:${group.groupId}`)}`,
      ruleId: "RA010",
      category: "duplication",
      severity: "medium",
      title: "Exact duplicate files detected",
      recommendation: "review",
      explanation: `${group.members.length} files have the same SHA-256 digest. Their distinct paths may still serve intentional packaging or compatibility purposes.`,
      confidence: confidence("high", 1, "All listed files have identical SHA-256 digests."),
      impact: "Unnecessary duplicates increase repository size and create unclear ownership, but automatic removal could break consumers.",
      evidence: group.members,
      destructive: false,
      approvalRequired: false,
      validation: ["Confirm whether each path has a documented consumer or packaging purpose."],
      rollback: [],
    });
  }

  for (const file of largeFiles) {
    findings.push({
      id: `raf_${stableHash(`RA023:${file.path}:${file.byteSize}`)}`,
      ruleId: "RA023",
      category: "large-files",
      severity: "low",
      title: "Large tracked file requires review",
      recommendation: "review",
      explanation: `${file.path} is ${file.byteSize} bytes, meeting the configured large-file threshold.`,
      confidence: confidence("high", 1, "The finding is based on the recorded file byte size."),
      impact: "Large files may slow cloning, CI, packaging, and browser-side audit ingestion.",
      evidence: [evidence(file.path, "size", { byteSize: file.byteSize, sha256: file.sha256 })],
      destructive: false,
      approvalRequired: false,
      validation: ["Confirm the file is required and assess whether a smaller deterministic fixture or external artifact is appropriate."],
      rollback: [],
    });
  }

  for (const file of generatedFiles) {
    findings.push({
      id: `raf_${stableHash(`RA020:${file.path}`)}`,
      ruleId: "RA020",
      category: "generated-files",
      severity: "info",
      title: "Generated output is present",
      recommendation: "keep",
      explanation: `${file.path} is classified as generated output. Tracking generated artifacts can be intentional and is not treated as a cleanup instruction.`,
      confidence: confidence(file.generated ? "high" : "medium", file.generated ? 1 : 0.78, file.generated ? "The snapshot explicitly marked the file as generated." : "The path or suffix matches a generated-output convention."),
      impact: "Generated output should have a documented reproducibility and release policy.",
      evidence: [evidence(file.path, "generated-marker", { byteSize: file.byteSize, sha256: file.sha256 })],
      destructive: false,
      approvalRequired: false,
      validation: ["Document how the artifact is reproduced and verified."],
      rollback: [],
    });
  }

  const cappedFindings = capFindings(findings, limits.maxFindings, reasons);
  const directorySet = new Set<string>();
  for (const file of accepted) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) directorySet.add(segments.slice(0, index).join("/"));
  }

  return {
    schema: "solvelang.repository-audit.inventory.v0",
    mode: "analyze-only",
    source: { ...snapshot.source },
    limits,
    execution: {
      status: reasons.size === 0 ? "complete" : "partial",
      truncated: reasons.size > 0,
      truncationReasons: [...reasons].sort(compareText),
      networkAccess: false,
      writeAccess: false,
    },
    summary: {
      filesSeen: allFiles.length,
      filesScanned: accepted.length,
      filesSkipped: allFiles.length - accepted.length,
      bytesScanned,
      directoriesSeen: directorySet.size,
    },
    inventory: {
      fileClasses: fileClassOrder.map((item) => ({ class: item, count: classCounts.get(item) ?? 0 })),
      languages: languageDetections(accepted),
      frameworks: frameworkDetections(accepted, limits.maxManifestTextBytes),
      packageManagers: packageManagerDetections(accepted),
      deploymentTargets: deploymentDetections(accepted, limits.maxManifestTextBytes),
      largeFiles: largeFiles.map((file) => evidence(file.path, "size", { byteSize: file.byteSize, sha256: file.sha256 })),
    },
    detections: {
      duplicates: duplicateGroups,
      backupCandidates: backupFiles.map((file) => evidence(file.path, "name-pattern", { byteSize: file.byteSize, sha256: file.sha256 })),
      generatedCandidates: generatedFiles.map((file) => evidence(file.path, "generated-marker", { byteSize: file.byteSize, sha256: file.sha256 })),
    },
    findings: cappedFindings,
  };
}
