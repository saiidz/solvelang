import {
  planSelfDrivingGitHubBaseBlobRequest,
  planSelfDrivingGitHubBaseTreeRequest,
  planSelfDrivingGitHubCreateBranchRequest,
  planSelfDrivingGitHubCreateCommitRequest,
  planSelfDrivingGitHubCreateTreeRequest,
  planSelfDrivingGitHubLivePreflightRequests,
  planSelfDrivingGitHubOpenPullRequestRequest,
  planSelfDrivingGitHubUpdateHeadRefRequest,
  type SelfDrivingGitHubRestRequestPlan,
} from "./selfDrivingGithubRestPlanner";
import {
  executeSelfDrivingGitHubRestRequest,
  type SelfDrivingGitHubAuthorizationBroker,
  type SelfDrivingGitHubRestSuccess,
  type SelfDrivingGitHubRestTransport,
} from "./selfDrivingGithubRestTransport";
import {
  assembleSelfDrivingGitHubRestPreflightEvidence,
  parseSelfDrivingGitHubBranchCreated,
  parseSelfDrivingGitHubCommitWriteSequence,
  parseSelfDrivingGitHubPullRequestOpened,
  type SelfDrivingGitHubRestPreflightEvidence,
} from "./selfDrivingGithubRestResponseAdapter";
import {
  materializeSelfDrivingPatchPlan,
  type SelfDrivingPatchMaterialization,
} from "./selfDrivingPatchMaterialization";
import type {
  SelfDrivingPrWriteAdapter,
  SelfDrivingPrWriteBranchRequest,
  SelfDrivingPrWriteCommitRequest,
  SelfDrivingPrWritePullRequestRequest,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

export type SelfDrivingGitHubPrWriteAdapterDependencies = Readonly<{
  authorizationBroker: SelfDrivingGitHubAuthorizationBroker;
  transport: SelfDrivingGitHubRestTransport;
  now: () => string;
}>;

export type SelfDrivingGitHubPrWriteAdapterStage =
  | "idle"
  | "preflight-running"
  | "preflight-ready"
  | "branch-running"
  | "branch-created"
  | "commit-running"
  | "committed"
  | "pull-request-running"
  | "pull-request-opened"
  | "failed";

type JsonRecord = Record<string, unknown>;

const EXPECTED_PR_TITLE = "Solve Self-Driving: reviewed validated change";

function expectedPrBody(planId: string): string {
  return `Self-Driving execution plan ${planId}. Automatic merge is disabled.`;
}

function asRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as JsonRecord;
}

function normalizeGitSha(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error(`${name} must be an exact 40-hex Git SHA.`);
  return normalized;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("GitHub PR write adapter cancelled.", "AbortError");
}

function sameFiles(
  left: SelfDrivingPrWriteCommitRequest["files"],
  right: SelfDrivingPrWriteCommitRequest["files"],
): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function assertDependencies(value: SelfDrivingGitHubPrWriteAdapterDependencies): void {
  if (!value || typeof value !== "object") throw new Error("GitHub PR write adapter dependencies are required.");
  if (typeof value.authorizationBroker !== "function") throw new Error("An injected GitHub authorization broker is required.");
  if (typeof value.transport !== "function") throw new Error("An injected bounded GitHub transport is required.");
  if (typeof value.now !== "function") throw new Error("An injected UTC clock is required.");
}

export function createSelfDrivingGitHubPrWriteAdapter(
  dependencies: SelfDrivingGitHubPrWriteAdapterDependencies,
): SelfDrivingPrWriteAdapter {
  assertDependencies(dependencies);

  let stage: SelfDrivingGitHubPrWriteAdapterStage = "idle";
  let permanentlyFailed = false;
  let boundPlan: SelfDrivingPrWriteExecutionPlan | undefined;
  let preflightEvidence: SelfDrivingGitHubRestPreflightEvidence | undefined;
  let materialization: SelfDrivingPatchMaterialization | undefined;
  let createdCommitSha: string | undefined;

  const fail = (error: unknown): never => {
    permanentlyFailed = true;
    stage = "failed";
    throw error;
  };

  const requireActiveStage = (expected: SelfDrivingGitHubPrWriteAdapterStage, operation: string): void => {
    if (permanentlyFailed || stage !== expected) {
      const actual = stage;
      permanentlyFailed = true;
      stage = "failed";
      throw new Error(`GitHub PR write adapter ${operation} requires stage ${expected}; current stage is ${actual}.`);
    }
  };

  const requireBoundPlan = (planId: string): SelfDrivingPrWriteExecutionPlan => {
    if (permanentlyFailed || !boundPlan || boundPlan.id !== planId) {
      return fail(new Error("GitHub PR write adapter request does not match the bound execution plan."));
    }
    return boundPlan;
  };

  const execute = async (
    request: SelfDrivingGitHubRestRequestPlan,
    signal?: AbortSignal,
  ): Promise<SelfDrivingGitHubRestSuccess> => {
    if (permanentlyFailed) throw new Error("GitHub PR write adapter is terminally failed.");
    assertNotAborted(signal);
    const result = await executeSelfDrivingGitHubRestRequest(
      request,
      dependencies.authorizationBroker,
      dependencies.transport,
    );
    assertNotAborted(signal);
    if (permanentlyFailed) throw new Error("GitHub PR write adapter became terminally failed during an in-flight request.");
    if (result.status !== "success") {
      throw new Error(`GitHub REST ${request.operation} failed (${result.failureCode}).`);
    }
    return result;
  };

  const extractTreeShaFromBaseCommit = (response: SelfDrivingGitHubRestSuccess): string => {
    const body = asRecord(response.body, "get-base-commit.body");
    const tree = asRecord(body.tree, "get-base-commit.body.tree");
    return normalizeGitSha(tree.sha, "get-base-commit.body.tree.sha");
  };

  const extractCreatedTreeSha = (response: SelfDrivingGitHubRestSuccess): string => {
    const body = asRecord(response.body, "create-tree.body");
    return normalizeGitSha(body.sha, "create-tree.body.sha");
  };

  const validateCreatedCommitBeforeRefUpdate = (
    response: SelfDrivingGitHubRestSuccess,
    expectedTreeSha: string,
    expectedParentRevision: string,
  ): string => {
    const body = asRecord(response.body, "create-commit.body");
    const commitSha = normalizeGitSha(body.sha, "create-commit.body.sha");
    const tree = asRecord(body.tree, "create-commit.body.tree");
    if (normalizeGitSha(tree.sha, "create-commit.body.tree.sha") !== expectedTreeSha) {
      throw new Error("Created Git commit tree does not match the exact reviewed tree before ref update.");
    }
    if (!Array.isArray(body.parents) || body.parents.length !== 1) {
      throw new Error("Created Git commit must have exactly one parent before ref update.");
    }
    const parent = asRecord(body.parents[0], "create-commit.body.parents[0]");
    if (normalizeGitSha(parent.sha, "create-commit.body.parents[0].sha") !== expectedParentRevision) {
      throw new Error("Created Git commit parent does not match the approved base revision before ref update.");
    }
    return commitSha;
  };

  const adapter: SelfDrivingPrWriteAdapter = {
    verifyLivePreflight: async (plan, signal) => {
      requireActiveStage("idle", "verifyLivePreflight");
      stage = "preflight-running";
      boundPlan = plan;
      try {
        assertNotAborted(signal);
        const [baseBranchPlan, baseRulesPlan, headRefPlan, baseCommitPlan] =
          planSelfDrivingGitHubLivePreflightRequests(plan);
        const baseBranch = await execute(baseBranchPlan, signal);
        const baseRules = await execute(baseRulesPlan, signal);
        const headRef = await execute(headRefPlan, signal);
        const baseCommit = await execute(baseCommitPlan, signal);

        const baseTreeSha = extractTreeShaFromBaseCommit(baseCommit);
        const baseTreePlan = planSelfDrivingGitHubBaseTreeRequest(plan.repository, baseTreeSha);
        const baseTree = await execute(baseTreePlan, signal);

        const uniqueBlobShas = [...new Set(plan.files.map((file) => file.baseBlobSha))].sort();
        const baseBlobs: SelfDrivingGitHubRestSuccess[] = [];
        for (const blobSha of uniqueBlobShas) {
          const blobPlan = planSelfDrivingGitHubBaseBlobRequest(plan.repository, blobSha);
          baseBlobs.push(await execute(blobPlan, signal));
        }

        assertNotAborted(signal);
        const evidence = assembleSelfDrivingGitHubRestPreflightEvidence(
          plan,
          dependencies.now(),
          { baseBranch, baseRules, headRef, baseCommit, baseTree, baseBlobs },
        );
        const materialized = await materializeSelfDrivingPatchPlan(plan, evidence.baseFiles);
        assertNotAborted(signal);
        requireActiveStage("preflight-running", "verifyLivePreflight completion");

        preflightEvidence = evidence;
        materialization = materialized;
        stage = "preflight-ready";
        return evidence.livePreflight;
      } catch (error) {
        return fail(error);
      }
    },

    createBranch: async (request: SelfDrivingPrWriteBranchRequest, signal) => {
      requireActiveStage("preflight-ready", "createBranch");
      const plan = requireBoundPlan(request.planId);
      if (
        request.repository !== plan.repository
        || request.baseRevision !== plan.baseRevision
        || request.headBranch !== plan.headBranch
      ) {
        return fail(new Error("GitHub create-branch request drifted from the bound execution plan."));
      }
      stage = "branch-running";
      try {
        const requestPlan = planSelfDrivingGitHubCreateBranchRequest(request);
        const response = await execute(requestPlan, signal);
        const parsed = parseSelfDrivingGitHubBranchCreated(request, response);
        requireActiveStage("branch-running", "createBranch completion");
        stage = "branch-created";
        return parsed;
      } catch (error) {
        return fail(error);
      }
    },

    createCommit: async (request: SelfDrivingPrWriteCommitRequest, signal) => {
      requireActiveStage("branch-created", "createCommit");
      const plan = requireBoundPlan(request.planId);
      if (
        request.repository !== plan.repository
        || request.headBranch !== plan.headBranch
        || request.expectedParentRevision !== plan.baseRevision
        || !sameFiles(request.files, plan.files)
      ) {
        return fail(new Error("GitHub create-commit request drifted from the bound execution plan."));
      }
      if (!preflightEvidence || !materialization) {
        return fail(new Error("GitHub create-commit requires qualified preflight evidence and materialization."));
      }

      stage = "commit-running";
      try {
        const treePlan = planSelfDrivingGitHubCreateTreeRequest(
          request,
          preflightEvidence.baseTreeSha,
          preflightEvidence.fileModes,
          materialization,
        );
        const treeResponse = await execute(treePlan, signal);
        const treeSha = extractCreatedTreeSha(treeResponse);

        const commitPlan = planSelfDrivingGitHubCreateCommitRequest(request, treeSha);
        const commitResponse = await execute(commitPlan, signal);
        const commitSha = validateCreatedCommitBeforeRefUpdate(
          commitResponse,
          treeSha,
          request.expectedParentRevision,
        );
        assertNotAborted(signal);
        if (permanentlyFailed) throw new Error("GitHub PR write adapter is terminally failed before ref update.");

        const updateRefPlan = planSelfDrivingGitHubUpdateHeadRefRequest(request, commitSha);
        const updateRefResponse = await execute(updateRefPlan, signal);
        const parsed = parseSelfDrivingGitHubCommitWriteSequence(
          request,
          preflightEvidence.baseTreeSha,
          preflightEvidence.fileModes,
          materialization,
          treeResponse,
          commitResponse,
          updateRefResponse,
        );
        requireActiveStage("commit-running", "createCommit completion");
        createdCommitSha = parsed.commitSha;
        stage = "committed";
        return parsed;
      } catch (error) {
        return fail(error);
      }
    },

    openPullRequest: async (request: SelfDrivingPrWritePullRequestRequest, signal) => {
      requireActiveStage("committed", "openPullRequest");
      const plan = requireBoundPlan(request.planId);
      if (
        request.repository !== plan.repository
        || request.baseBranch !== plan.baseBranch
        || request.headBranch !== plan.headBranch
        || request.headRevision !== createdCommitSha
        || request.title !== EXPECTED_PR_TITLE
        || request.body !== expectedPrBody(plan.id)
      ) {
        return fail(new Error("GitHub open-PR request drifted from the bound execution plan or fixed PR metadata."));
      }
      stage = "pull-request-running";
      try {
        const requestPlan = planSelfDrivingGitHubOpenPullRequestRequest(request);
        const response = await execute(requestPlan, signal);
        const parsed = parseSelfDrivingGitHubPullRequestOpened(request, response);
        requireActiveStage("pull-request-running", "openPullRequest completion");
        stage = "pull-request-opened";
        return parsed;
      } catch (error) {
        return fail(error);
      }
    },
  };

  return Object.freeze(adapter);
}
