import assert from "node:assert/strict";
import test from "node:test";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";
import {
  materializeSelfDrivingPatchPlan,
  SELF_DRIVING_PATCH_MATERIALIZATION_SCHEMA,
} from "./selfDrivingPatchMaterialization";

const BASE_REVISION = "a".repeat(40);
const BLOB_A = "b".repeat(40);
const BLOB_B = "c".repeat(40);

function plan(files: SelfDrivingPrWriteExecutionPlan["files"]): SelfDrivingPrWriteExecutionPlan {
  const hunks = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const lines = files.reduce((sum, file) => sum + file.hunks.reduce((inner, hunk) => inner + hunk.lines.length, 0), 0);
  const patchBytes = files.reduce((sum, file) => sum + file.hunks.reduce(
    (inner, hunk) => inner + hunk.lines.reduce((lineSum, line) => lineSum + new TextEncoder().encode(line).length, 0),
    0,
  ), 0);
  return {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0",
    mode: "no-write-execution-plan",
    status: "ready-for-separate-github-executor",
    id: `pr_write_plan_${"d".repeat(64)}`,
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE_REVISION,
    headBranch: "solve/materialize-fixture",
    installationRef: "github-app/installation:fixture",
    approvalId: "approval-fixture",
    approvalBindingSha256: "e".repeat(64),
    claimId: "claim-fixture",
    claimedAt: "2026-09-07T16:40:00Z",
    requiredPermissions: { metadata: "read", contents: "write", pullRequests: "write" },
    plannedActions: ["create-branch", "create-commit", "open-pr"],
    requiredLiveChecks: [
      "verify-exact-base-revision",
      "verify-fresh-branch-protection",
      "verify-head-branch-absent",
      "verify-base-blob-shas",
    ],
    branchProtectionEvidence: {
      protectedBranches: ["main"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI"],
      observedAt: "2026-09-07T16:39:00Z",
      evidenceLocator: "github:ruleset:fixture",
    },
    selectedProposals: files.map((file, index) => ({
      validationId: file.validationId,
      patchProposalId: file.proposalId,
      suggestionProposalId: file.suggestionProposalId,
      findingId: file.findingId,
      severity: "high" as const,
    })),
    files,
    limits: {
      maxSelectedProposals: 25,
      maxFiles: 50,
      maxHunks: 256,
      maxLines: 2500,
      maxPatchBytes: 131072,
      maxClaimIdLength: 128,
    },
    totals: {
      proposals: files.length,
      files: files.length,
      hunks,
      lines,
      patchBytes,
    },
    policy: {
      sourceArtifactsRecreated: true,
      cryptographicApprovalBindingVerified: true,
      successfulSingleUseClaimRequired: true,
      exactBaseRevisionRequiredAtExecution: true,
      freshBranchProtectionRequiredAtExecution: true,
      headBranchMustNotExistAtExecution: true,
      baseBlobShaMatchRequiredAtExecution: true,
      directPushToBaseAllowed: false,
      directPushToProtectedBranchAllowed: false,
      forcePushAllowed: false,
      automaticMergeAllowed: false,
      credentialResolutionAccess: false,
      githubApiAccess: false,
      branchCreationAccess: false,
      commitWriteAccess: false,
      pullRequestCreationAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
      writeExecutionStatus: "not-executed",
    },
  };
}

function file(
  path: string,
  baseBlobSha: string,
  hunks: SelfDrivingPrWriteExecutionPlan["files"][number]["hunks"],
  index = 0,
): SelfDrivingPrWriteExecutionPlan["files"][number] {
  return {
    proposalId: `patch_${index}`,
    validationId: `validation_${index}`,
    suggestionProposalId: `suggestion_${index}`,
    findingId: `finding_${index}`,
    path,
    baseBlobSha,
    hunks,
  };
}

test("materializes exact reviewed replacement against verified LF base content", async () => {
  const source = plan([file("site/app/a.ts", BLOB_A, [{
    oldStart: 2,
    oldLines: 1,
    newStart: 2,
    newLines: 1,
    lines: ["-old", "+new"],
  }])]);

  const result = await materializeSelfDrivingPatchPlan(source, [{
    path: "site/app/a.ts",
    blobSha: BLOB_A,
    content: "alpha\nold\nomega\n",
  }]);

  assert.equal(result.schema, SELF_DRIVING_PATCH_MATERIALIZATION_SCHEMA);
  assert.equal(result.status, "materialized");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].content, "alpha\nnew\nomega\n");
  assert.match(result.files[0].contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.files[0].finalLf, true);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.externalSideEffects, false);
});

test("enforces cross-hunk new-file coordinates after earlier line-count changes", async () => {
  const source = plan([file("site/app/a.ts", BLOB_A, [
    {
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 2,
      lines: ["-b", "+B", "+BB"],
    },
    {
      oldStart: 4,
      oldLines: 1,
      newStart: 5,
      newLines: 1,
      lines: ["-d", "+D"],
    },
  ])]);
  const result = await materializeSelfDrivingPatchPlan(source, [{
    path: "site/app/a.ts",
    blobSha: BLOB_A,
    content: "a\nb\nc\nd\n",
  }]);
  assert.equal(result.files[0].content, "a\nB\nBB\nc\nD\n");

  const forged = plan([file("site/app/a.ts", BLOB_A, [
    {
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 2,
      lines: ["-b", "+B", "+BB"],
    },
    {
      oldStart: 4,
      oldLines: 1,
      newStart: 4,
      newLines: 1,
      lines: ["-d", "+D"],
    },
  ])]);
  await assert.rejects(
    () => materializeSelfDrivingPatchPlan(forged, [{ path: "site/app/a.ts", blobSha: BLOB_A, content: "a\nb\nc\nd\n" }]),
    /newStart does not match materialized position/,
  );
});

test("rejects context or deletion drift instead of applying against changed content", async () => {
  for (const lines of [
    [" context", "-old", "+new"],
    ["-different", "+new"],
  ]) {
    const source = plan([file("site/app/a.ts", BLOB_A, [{
      oldStart: 2,
      oldLines: lines[0].startsWith(" ") ? 2 : 1,
      newStart: 2,
      newLines: lines.filter((line) => line[0] !== "-").length,
      lines,
    }])]);
    await assert.rejects(
      () => materializeSelfDrivingPatchPlan(source, [{
        path: "site/app/a.ts",
        blobSha: BLOB_A,
        content: "alpha\nold\nomega\n",
      }]),
      /context does not match|deletion does not match/,
    );
  }
});

test("supports deterministic insertion into an exact empty base and emits final LF", async () => {
  const source = plan([file("site/app/empty.ts", BLOB_A, [{
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 2,
    lines: ["+first", "+second"],
  }])]);
  const result = await materializeSelfDrivingPatchPlan(source, [{
    path: "site/app/empty.ts",
    blobSha: BLOB_A,
    content: "",
  }]);
  assert.equal(result.files[0].content, "first\nsecond\n");
  assert.equal(result.files[0].lines, 2);
  assert.equal(result.files[0].finalLf, true);
});

test("rejects CRLF, binary NUL, and ambiguous non-empty missing-final-newline bases", async () => {
  const source = plan([file("site/app/a.ts", BLOB_A, [{
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: ["-old", "+new"],
  }])]);
  for (const [content, pattern] of [
    ["old\r\n", /LF line endings only/],
    ["old\u0000\n", /binary NUL/],
    ["old", /missing final newline/],
  ] as const) {
    await assert.rejects(
      () => materializeSelfDrivingPatchPlan(source, [{ path: "site/app/a.ts", blobSha: BLOB_A, content }]),
      pattern,
    );
  }
});

test("requires exact planned path and base blob coverage with no duplicates or extras", async () => {
  const source = plan([
    file("site/app/a.ts", BLOB_A, [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+A"] }], 0),
    file("site/app/b.ts", BLOB_B, [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-b", "+B"] }], 1),
  ]);

  await assert.rejects(
    () => materializeSelfDrivingPatchPlan(source, [
      { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
      { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
    ]),
    /duplicate path/,
  );
  await assert.rejects(
    () => materializeSelfDrivingPatchPlan(source, [
      { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
      { path: "site/app/b.ts", blobSha: BLOB_A, content: "b\n" },
    ]),
    /Base blob SHA does not match/,
  );
  await assert.rejects(
    () => materializeSelfDrivingPatchPlan(source, [
      { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
      { path: "site/app/extra.ts", blobSha: BLOB_B, content: "b\n" },
    ]),
    /unplanned path/,
  );
});

test("materialization is deterministic for equivalent base-file input ordering", async () => {
  const source = plan([
    file("site/app/a.ts", BLOB_A, [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+A"] }], 0),
    file("site/app/b.ts", BLOB_B, [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-b", "+B"] }], 1),
  ]);
  const forward = await materializeSelfDrivingPatchPlan(source, [
    { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
    { path: "site/app/b.ts", blobSha: BLOB_B, content: "b\n" },
  ]);
  const reverse = await materializeSelfDrivingPatchPlan(source, [
    { path: "site/app/b.ts", blobSha: BLOB_B, content: "b\n" },
    { path: "site/app/a.ts", blobSha: BLOB_A, content: "a\n" },
  ]);
  assert.deepEqual(forward, reverse);
});
