import type {
  SolveGraphScanFile,
  SolveGraphScanLimits,
  SolveGraphScanPlan,
  SolveGraphScanSkip,
} from "./contracts";

export const defaultSolveGraphScanLimits: SolveGraphScanLimits = Object.freeze({
  maxFiles: 50_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 250_000,
  maxEdges: 1_000_000,
  maxEvidencePerElement: 32,
  maxMetadataEntries: 32,
  maxMetadataStringBytes: 4096,
  maxIdentityBytes: 4096,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

export function validateSolveGraphScanLimits(input: SolveGraphScanLimits): SolveGraphScanLimits {
  const limits: SolveGraphScanLimits = {
    maxFiles: positiveSafeInteger(input.maxFiles, "Solve Graph maxFiles"),
    maxTotalBytes: positiveSafeInteger(input.maxTotalBytes, "Solve Graph maxTotalBytes"),
    maxFileBytes: positiveSafeInteger(input.maxFileBytes, "Solve Graph maxFileBytes"),
    maxDepth: positiveSafeInteger(input.maxDepth, "Solve Graph maxDepth"),
    maxNodes: positiveSafeInteger(input.maxNodes, "Solve Graph maxNodes"),
    maxEdges: positiveSafeInteger(input.maxEdges, "Solve Graph maxEdges"),
    maxEvidencePerElement: positiveSafeInteger(input.maxEvidencePerElement, "Solve Graph maxEvidencePerElement"),
    maxMetadataEntries: positiveSafeInteger(input.maxMetadataEntries, "Solve Graph maxMetadataEntries"),
    maxMetadataStringBytes: positiveSafeInteger(input.maxMetadataStringBytes, "Solve Graph maxMetadataStringBytes"),
    maxIdentityBytes: positiveSafeInteger(input.maxIdentityBytes, "Solve Graph maxIdentityBytes"),
  };
  if (limits.maxFileBytes > limits.maxTotalBytes) {
    throw new Error("Solve Graph maxFileBytes cannot exceed maxTotalBytes.");
  }
  return limits;
}

export function normalizeSolveGraphPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error("Solve Graph paths must be non-empty strings.");
  if (input.includes("\0")) throw new Error("Solve Graph paths cannot contain NUL bytes.");
  if (input.includes("\\")) throw new Error(`Solve Graph path must use POSIX separators: ${input}`);
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new Error(`Solve Graph path must be repository-relative: ${input}`);
  const parts: string[] = [];
  for (const segment of input.normalize("NFC").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") throw new Error(`Solve Graph path cannot traverse outside the repository: ${input}`);
    parts.push(segment);
  }
  if (parts.length === 0) throw new Error("Solve Graph path must identify a repository entry.");
  return parts.join("/");
}

export function solveGraphPathDepth(path: string): number {
  return normalizeSolveGraphPath(path).split("/").length;
}

function normalizeScanFile(file: SolveGraphScanFile): SolveGraphScanFile {
  if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0) {
    throw new Error(`Solve Graph byteSize must be a non-negative safe integer: ${file.path}`);
  }
  return { path: normalizeSolveGraphPath(file.path), byteSize: file.byteSize };
}

function skip(file: SolveGraphScanFile, reason: SolveGraphScanSkip["reason"]): SolveGraphScanSkip {
  return { ...file, reason };
}

export function planBoundedSolveGraphScan(
  files: readonly SolveGraphScanFile[],
  inputLimits: SolveGraphScanLimits = defaultSolveGraphScanLimits,
): SolveGraphScanPlan {
  const limits = validateSolveGraphScanLimits(inputLimits);
  const normalized = files.map(normalizeScanFile)
    .sort((left, right) => compareText(left.path, right.path) || left.byteSize - right.byteSize);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].path === normalized[index].path) {
      throw new Error(`Solve Graph scan input contains duplicate path: ${normalized[index].path}`);
    }
  }

  const accepted: SolveGraphScanFile[] = [];
  const skipped: SolveGraphScanSkip[] = [];
  let totalAcceptedBytes = 0;

  for (const file of normalized) {
    if (solveGraphPathDepth(file.path) > limits.maxDepth) {
      skipped.push(skip(file, "depth"));
      continue;
    }
    if (file.byteSize > limits.maxFileBytes) {
      skipped.push(skip(file, "file-size"));
      continue;
    }
    if (accepted.length >= limits.maxFiles) {
      skipped.push(skip(file, "file-count"));
      continue;
    }
    if (totalAcceptedBytes + file.byteSize > limits.maxTotalBytes) {
      skipped.push(skip(file, "total-bytes"));
      continue;
    }
    accepted.push(file);
    totalAcceptedBytes += file.byteSize;
  }

  const truncationReasons = [...new Set(skipped.map((item) => item.reason))]
    .sort(compareText) as SolveGraphScanPlan["truncationReasons"];

  return {
    status: skipped.length === 0 ? "complete" : "partial",
    accepted,
    skipped,
    totalAcceptedBytes,
    truncationReasons,
  };
}
