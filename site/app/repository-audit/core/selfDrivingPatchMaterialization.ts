import {
  SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
  type SelfDrivingPrWriteExecutionPlan,
} from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_PATCH_MATERIALIZATION_SCHEMA =
  "solvelang.self-driving.patch-materialization.v0" as const;

export const defaultSelfDrivingPatchMaterializationLimits = Object.freeze({
  maxFiles: 50,
  maxBaseBytesPerFile: 1_048_576,
  maxBaseLinesPerFile: 50_000,
  maxTotalBaseBytes: 8_388_608,
  maxTotalResultBytes: 8_388_608,
});

export type SelfDrivingPatchBaseFileInput = Readonly<{
  path: string;
  blobSha: string;
  content: string;
}>;

export type SelfDrivingMaterializedPatchFile = Readonly<{
  path: string;
  baseBlobSha: string;
  content: string;
  contentSha256: string;
  bytes: number;
  lines: number;
  finalLf: boolean;
}>;

export type SelfDrivingPatchMaterialization = Readonly<{
  schema: typeof SELF_DRIVING_PATCH_MATERIALIZATION_SCHEMA;
  mode: "pure-text-materialization";
  status: "materialized";
  planId: string;
  repository: string;
  baseRevision: string;
  files: readonly SelfDrivingMaterializedPatchFile[];
  totals: Readonly<{
    files: number;
    baseBytes: number;
    resultBytes: number;
    resultLines: number;
  }>;
  policy: Readonly<{
    exactPlanPathsRequired: true;
    exactBaseBlobShaRequired: true;
    structuredReviewedHunksOnly: true;
    exactContextAndDeletionMatchRequired: true;
    exactOldAndNewCoordinatesRequired: true;
    utf8LfTextOnly: true;
    ambiguousMissingFinalNewlineRejected: true;
    emptyBaseResultUsesFinalLf: true;
    binaryContentAllowed: false;
    credentialResolutionAccess: false;
    githubApiAccess: false;
    patchApplicationToRepositoryAccess: false;
    shellExecutionAccess: false;
    networkAccess: false;
    repositoryWriteAccess: false;
    providerAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    externalSideEffects: false;
  }>;
}>;

const textEncoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) throw new Error(`${name} must be bounded non-empty text.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} contains unsupported control characters.`);
  if (normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("//")) {
    throw new Error(`${name} must be a canonical repository-relative path.`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${name} contains an unsafe path segment.`);
  }
  return normalized;
}

function normalizeBlobSha(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error(`${name} must be an exact 40-hex Git blob SHA.`);
  return normalized;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for patch materialization.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSafePlan(plan: SelfDrivingPrWriteExecutionPlan): void {
  if (!plan || typeof plan !== "object" || plan.schema !== SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA) {
    throw new Error("A canonical PR write execution plan is required.");
  }
  if (plan.mode !== "no-write-execution-plan" || plan.status !== "ready-for-separate-github-executor") {
    throw new Error("Patch materialization requires the canonical no-write execution plan.");
  }
  const policy = plan.policy;
  if (
    !policy
    || policy.sourceArtifactsRecreated !== true
    || policy.cryptographicApprovalBindingVerified !== true
    || policy.successfulSingleUseClaimRequired !== true
    || policy.exactBaseRevisionRequiredAtExecution !== true
    || policy.baseBlobShaMatchRequiredAtExecution !== true
    || policy.directPushToBaseAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.automaticMergeAllowed !== false
    || policy.githubApiAccess !== false
    || policy.patchApplicationAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.networkAccess !== false
    || policy.externalSideEffects !== false
    || policy.writeExecutionStatus !== "not-executed"
  ) {
    throw new Error("Patch materialization requires the safe no-write execution-plan policy.");
  }
  if (!Array.isArray(plan.files) || plan.files.length === 0) {
    throw new Error("Patch materialization requires at least one planned file.");
  }
  if (plan.files.length > defaultSelfDrivingPatchMaterializationLimits.maxFiles) {
    throw new Error(`Patch materialization exceeds the ${defaultSelfDrivingPatchMaterializationLimits.maxFiles}-file bound.`);
  }
}

function splitBaseContent(content: string, name: string): { lines: string[]; bytes: number; empty: boolean } {
  if (typeof content !== "string") throw new Error(`${name}.content must be a string.`);
  if (content.includes("\u0000")) throw new Error(`${name}.content contains binary NUL data.`);
  if (content.includes("\r")) throw new Error(`${name}.content must use LF line endings only.`);
  const bytes = textEncoder.encode(content).length;
  if (bytes > defaultSelfDrivingPatchMaterializationLimits.maxBaseBytesPerFile) {
    throw new Error(`${name}.content exceeds the ${defaultSelfDrivingPatchMaterializationLimits.maxBaseBytesPerFile}-byte base-file bound.`);
  }
  if (content === "") return { lines: [], bytes, empty: true };
  if (!content.endsWith("\n")) {
    throw new Error(`${name}.content has an ambiguous missing final newline; v0 requires final LF.`);
  }
  const lines = content.slice(0, -1).split("\n");
  if (lines.length > defaultSelfDrivingPatchMaterializationLimits.maxBaseLinesPerFile) {
    throw new Error(`${name}.content exceeds the ${defaultSelfDrivingPatchMaterializationLimits.maxBaseLinesPerFile}-line base-file bound.`);
  }
  return { lines, bytes, empty: false };
}

function applyReviewedHunks(
  baseLines: string[],
  file: SelfDrivingPrWriteExecutionPlan["files"][number],
): string[] {
  const output: string[] = [];
  let cursor = 0;

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex += 1) {
    const hunk = file.hunks[hunkIndex];
    const targetIndex = hunk.oldStart - 1;
    if (!Number.isSafeInteger(targetIndex) || targetIndex < cursor || targetIndex > baseLines.length) {
      throw new Error(`planned file ${file.path} hunk ${hunkIndex} has an invalid or overlapping oldStart.`);
    }
    if (hunk.oldLines > 0 && targetIndex >= baseLines.length) {
      throw new Error(`planned file ${file.path} hunk ${hunkIndex} starts beyond the base file.`);
    }
    if (targetIndex + hunk.oldLines > baseLines.length) {
      throw new Error(`planned file ${file.path} hunk ${hunkIndex} consumes beyond the base file.`);
    }

    output.push(...baseLines.slice(cursor, targetIndex));
    const expectedNewStart = output.length + 1;
    if (hunk.newStart !== expectedNewStart) {
      throw new Error(`planned file ${file.path} hunk ${hunkIndex} newStart does not match materialized position.`);
    }

    let consumedOld = 0;
    let emittedNew = 0;
    let baseIndex = targetIndex;
    for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
      const patchLine = hunk.lines[lineIndex];
      if (typeof patchLine !== "string" || patchLine.length === 0) {
        throw new Error(`planned file ${file.path} hunk ${hunkIndex} contains an invalid patch line.`);
      }
      const prefix = patchLine[0];
      const text = patchLine.slice(1);
      if (prefix === " ") {
        if (baseLines[baseIndex] !== text) {
          throw new Error(`planned file ${file.path} hunk ${hunkIndex} context does not match the exact base content.`);
        }
        output.push(text);
        baseIndex += 1;
        consumedOld += 1;
        emittedNew += 1;
      } else if (prefix === "-") {
        if (baseLines[baseIndex] !== text) {
          throw new Error(`planned file ${file.path} hunk ${hunkIndex} deletion does not match the exact base content.`);
        }
        baseIndex += 1;
        consumedOld += 1;
      } else if (prefix === "+") {
        output.push(text);
        emittedNew += 1;
      } else {
        throw new Error(`planned file ${file.path} hunk ${hunkIndex} contains an unsupported patch prefix.`);
      }
    }
    if (consumedOld !== hunk.oldLines || emittedNew !== hunk.newLines) {
      throw new Error(`planned file ${file.path} hunk ${hunkIndex} line counts do not match the reviewed hunk.`);
    }
    cursor = targetIndex + consumedOld;
  }

  output.push(...baseLines.slice(cursor));
  return output;
}

export async function materializeSelfDrivingPatchPlan(
  plan: SelfDrivingPrWriteExecutionPlan,
  baseFiles: readonly SelfDrivingPatchBaseFileInput[],
): Promise<SelfDrivingPatchMaterialization> {
  assertSafePlan(plan);
  if (!Array.isArray(baseFiles) || baseFiles.length !== plan.files.length) {
    throw new Error("Base-file inputs must cover every planned file exactly once.");
  }

  const planByPath = new Map(plan.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const results: SelfDrivingMaterializedPatchFile[] = [];
  let totalBaseBytes = 0;
  let totalResultBytes = 0;
  let totalResultLines = 0;

  for (let index = 0; index < baseFiles.length; index += 1) {
    const input = baseFiles[index];
    if (!input || typeof input !== "object") throw new Error(`baseFiles[${index}] must be an object.`);
    const path = normalizePath(input.path, `baseFiles[${index}].path`);
    if (seen.has(path)) throw new Error(`Base-file inputs contain duplicate path ${path}.`);
    seen.add(path);
    const planned = planByPath.get(path);
    if (!planned) throw new Error(`Base-file input contains unplanned path ${path}.`);
    const blobSha = normalizeBlobSha(input.blobSha, `baseFiles[${index}].blobSha`);
    if (blobSha !== planned.baseBlobSha) throw new Error(`Base blob SHA does not match the reviewed plan for ${path}.`);

    const base = splitBaseContent(input.content, `baseFiles[${index}]`);
    totalBaseBytes += base.bytes;
    if (totalBaseBytes > defaultSelfDrivingPatchMaterializationLimits.maxTotalBaseBytes) {
      throw new Error(`Base-file inputs exceed the ${defaultSelfDrivingPatchMaterializationLimits.maxTotalBaseBytes}-byte total bound.`);
    }

    const outputLines = applyReviewedHunks(base.lines, planned);
    const content = outputLines.length === 0 ? "" : `${outputLines.join("\n")}\n`;
    const bytes = textEncoder.encode(content).length;
    totalResultBytes += bytes;
    totalResultLines += outputLines.length;
    if (totalResultBytes > defaultSelfDrivingPatchMaterializationLimits.maxTotalResultBytes) {
      throw new Error(`Materialized output exceeds the ${defaultSelfDrivingPatchMaterializationLimits.maxTotalResultBytes}-byte total bound.`);
    }

    results.push(Object.freeze({
      path,
      baseBlobSha: blobSha,
      content,
      contentSha256: await sha256Hex(content),
      bytes,
      lines: outputLines.length,
      finalLf: outputLines.length > 0,
    }));
  }

  results.sort((left, right) => compareText(left.path, right.path));
  if (results.length !== plan.files.length || results.some((file, index) => file.path !== [...plan.files].sort((a, b) => compareText(a.path, b.path))[index].path)) {
    throw new Error("Base-file inputs do not exactly cover the planned path set.");
  }

  return Object.freeze({
    schema: SELF_DRIVING_PATCH_MATERIALIZATION_SCHEMA,
    mode: "pure-text-materialization" as const,
    status: "materialized" as const,
    planId: plan.id,
    repository: plan.repository,
    baseRevision: plan.baseRevision,
    files: Object.freeze(results),
    totals: Object.freeze({
      files: results.length,
      baseBytes: totalBaseBytes,
      resultBytes: totalResultBytes,
      resultLines: totalResultLines,
    }),
    policy: Object.freeze({
      exactPlanPathsRequired: true as const,
      exactBaseBlobShaRequired: true as const,
      structuredReviewedHunksOnly: true as const,
      exactContextAndDeletionMatchRequired: true as const,
      exactOldAndNewCoordinatesRequired: true as const,
      utf8LfTextOnly: true as const,
      ambiguousMissingFinalNewlineRejected: true as const,
      emptyBaseResultUsesFinalLf: true as const,
      binaryContentAllowed: false as const,
      credentialResolutionAccess: false as const,
      githubApiAccess: false as const,
      patchApplicationToRepositoryAccess: false as const,
      shellExecutionAccess: false as const,
      networkAccess: false as const,
      repositoryWriteAccess: false as const,
      providerAccess: false as const,
      productionMutationAccess: false as const,
      billingMutationAccess: false as const,
      solveRunnerAuthority: false as const,
      externalSideEffects: false as const,
    }),
  });
}
