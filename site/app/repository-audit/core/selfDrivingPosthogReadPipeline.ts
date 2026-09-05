import {
  createSolveInbox,
  type SelfDrivingMode,
  type SolveInbox,
} from "./selfDriving";
import {
  analyzeAiContext,
  type AiScoutAnalysis,
  type AiScoutBudgetPolicy,
} from "./selfDrivingAiScout";
import {
  analyzeProductContext,
  type ExperienceScoutBudgets,
  type ProductScoutAnalysis,
  type RolloutScoutBudgets,
} from "./selfDrivingProductScouts";
import {
  adaptSanitizedPostHogExport,
  type PostHogOfflineAdapterResult,
  type PostHogSanitizedExportV0,
} from "./selfDrivingPosthogExport";
import {
  executePostHogReadPlan,
  type PostHogAuthProvider,
  type PostHogTransport,
  type PostHogTransportOptions,
  type PostHogTransportResult,
} from "./selfDrivingPosthogTransport";
import type { PostHogRequestPlan } from "./selfDrivingPosthogRequestPlanner";
import { POSTHOG_READONLY_CONNECTOR_POLICY } from "./selfDrivingProviderConnector";

export type PostHogResponseSanitizerInput = Readonly<{
  operation: string;
  project: string;
  requestId: string;
  json: unknown;
}>;

export type PostHogResponseSanitizer = (
  input: PostHogResponseSanitizerInput,
) => PostHogSanitizedExportV0 | Promise<PostHogSanitizedExportV0>;

export type PostHogReadPipelineOptions = {
  requestedMode?: SelfDrivingMode;
  transport?: PostHogTransportOptions;
  maxSignals?: number;
  maxFindings?: number;
  aiBudgets?: AiScoutBudgetPolicy;
  experienceBudgets?: ExperienceScoutBudgets;
  rolloutBudgets?: RolloutScoutBudgets;
};

export type PostHogReadPipelinePartialReason =
  | "source-partial"
  | "context-truncated"
  | "product-inbox-truncated"
  | "ai-inbox-truncated"
  | "inbox-truncated";

export type PostHogReadPipelineResult = {
  schema: "solvelang.self-driving.posthog-read-pipeline.v0";
  mode: "analyze-only";
  source: {
    provider: "posthog";
    operation: string;
    project: string;
    requestId: string;
    sanitizedCoverage: "complete" | "partial";
    skipped: PostHogOfflineAdapterResult["source"]["skipped"];
  };
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    injectedTransportOnly: true;
    injectedSanitizerRequired: true;
    rawProviderJsonReturned: false;
    credentialMaterialReturned: false;
    rawHeadersReturned: false;
    causalityInference: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    externalSideEffectsOwnedByCore: false;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: PostHogReadPipelinePartialReason[];
    transportBodyBytes: number;
    contextSignals: number;
    productFindings: number;
    aiFindings: number;
    emittedFindings: number;
  };
  transport: Omit<PostHogTransportResult, "json">;
  context: PostHogOfflineAdapterResult["context"];
  product: ProductScoutAnalysis;
  ai: AiScoutAnalysis;
  inbox: SolveInbox;
};

export type PostHogReadPipelineFailureCategory = "sanitization";

export class PostHogReadPipelineFailure extends Error {
  readonly category: PostHogReadPipelineFailureCategory;

  constructor(category: PostHogReadPipelineFailureCategory, message: string) {
    super(message);
    this.name = "PostHogReadPipelineFailure";
    this.category = category;
  }
}

const allowedContextKindsByOperation = Object.freeze({
  "read-events": new Set(["runtime-event", "ai-trace", "mcp-tool-call"]),
  "read-errors": new Set(["error"]),
  "read-feature-flags": new Set(["feature-flag"]),
} as const);

function identifyPlan(plan: PostHogRequestPlan): { operation: string; project: string } {
  const pathname = plan.request.pathname;
  const matches: Array<{ operation: string; project: string }> = [];

  for (const operation of POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations) {
    const marker = "{project}";
    const markerIndex = operation.pathTemplate.indexOf(marker);
    if (markerIndex < 0) continue;
    const prefix = operation.pathTemplate.slice(0, markerIndex);
    const suffix = operation.pathTemplate.slice(markerIndex + marker.length);
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) continue;

    const encodedProject = pathname.slice(prefix.length, pathname.length - suffix.length);
    if (!encodedProject) continue;
    try {
      const project = decodeURIComponent(encodedProject);
      if (encodeURIComponent(project) !== encodedProject) continue;
      matches.push({ operation: operation.operation, project });
    } catch {
      continue;
    }
  }

  if (matches.length !== 1) {
    throw new Error("PostHog read pipeline requires one exact allowlisted operation path.");
  }
  return matches[0];
}

function stripTransportJson(result: PostHogTransportResult): Omit<PostHogTransportResult, "json"> {
  return {
    schema: result.schema,
    mode: result.mode,
    source: { ...result.source },
    policy: { ...result.policy },
    execution: { ...result.execution },
  };
}

function sanitizedFailure(): PostHogReadPipelineFailure {
  return new PostHogReadPipelineFailure(
    "sanitization",
    "PostHog response sanitization failed without exposing raw provider details.",
  );
}

function assertSanitizedIdentity(
  adapted: PostHogOfflineAdapterResult,
  operation: string,
  project: string,
  requestId: string,
): void {
  if (adapted.source.projectLocator !== `project:${project}`) throw sanitizedFailure();
  if (adapted.source.exportLocator !== `request:${requestId}`) throw sanitizedFailure();

  const allowed = allowedContextKindsByOperation[
    operation as keyof typeof allowedContextKindsByOperation
  ];
  if (!allowed) throw sanitizedFailure();
  if (adapted.context.signals.some((signal) => !allowed.has(signal.kind as never))) {
    throw sanitizedFailure();
  }
}

export async function executePostHogReadPipeline(
  plan: PostHogRequestPlan,
  authProvider: PostHogAuthProvider,
  transport: PostHogTransport,
  sanitizer: PostHogResponseSanitizer,
  options: PostHogReadPipelineOptions = {},
): Promise<PostHogReadPipelineResult> {
  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`PostHog read pipeline mode '${requestedMode}' is not enabled. The pipeline is observe-only.`);
  }
  if (typeof sanitizer !== "function") {
    throw new Error("PostHog read pipeline requires an injected response sanitizer.");
  }

  const transportResult = await executePostHogReadPlan(
    plan,
    authProvider,
    transport,
    options.transport,
  );
  const identity = identifyPlan(plan);

  let sanitizedExport: PostHogSanitizedExportV0;
  try {
    sanitizedExport = await sanitizer(Object.freeze({
      operation: identity.operation,
      project: identity.project,
      requestId: plan.request.id,
      json: transportResult.json,
    }));
  } catch {
    throw sanitizedFailure();
  }

  let adapted: PostHogOfflineAdapterResult;
  try {
    adapted = adaptSanitizedPostHogExport(sanitizedExport, {
      requestedMode: "observe",
      ...(options.maxSignals === undefined ? {} : { maxSignals: options.maxSignals }),
    });
    assertSanitizedIdentity(
      adapted,
      identity.operation,
      identity.project,
      plan.request.id,
    );
  } catch (error) {
    if (error instanceof PostHogReadPipelineFailure) throw error;
    throw sanitizedFailure();
  }

  const context = adapted.context;
  const product = analyzeProductContext(context, {
    requestedMode: "observe",
    ...(options.experienceBudgets === undefined
      ? {}
      : { experienceBudgets: options.experienceBudgets }),
    ...(options.rolloutBudgets === undefined
      ? {}
      : { rolloutBudgets: options.rolloutBudgets }),
  });
  const ai = analyzeAiContext(context, {
    requestedMode: "observe",
    ...(options.aiBudgets === undefined ? {} : { budgets: options.aiBudgets }),
  });
  const inbox = createSolveInbox(
    [...product.inbox.items, ...ai.inbox.items],
    {
      requestedMode: "observe",
      ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
    },
  );

  const partialReasons: PostHogReadPipelinePartialReason[] = [];
  if (adapted.source.coverage === "partial") partialReasons.push("source-partial");
  if (context.execution.truncated || context.execution.status === "partial") {
    partialReasons.push("context-truncated");
  }
  if (product.inbox.execution.truncated) partialReasons.push("product-inbox-truncated");
  if (ai.inbox.execution.truncated) partialReasons.push("ai-inbox-truncated");
  if (inbox.execution.truncated) partialReasons.push("inbox-truncated");

  return {
    schema: "solvelang.self-driving.posthog-read-pipeline.v0",
    mode: "analyze-only",
    source: {
      provider: "posthog",
      operation: identity.operation,
      project: identity.project,
      requestId: plan.request.id,
      sanitizedCoverage: adapted.source.coverage,
      skipped: adapted.source.skipped.map((item) => ({ ...item })),
    },
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      injectedTransportOnly: true,
      injectedSanitizerRequired: true,
      rawProviderJsonReturned: false,
      credentialMaterialReturned: false,
      rawHeadersReturned: false,
      causalityInference: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      externalSideEffectsOwnedByCore: false,
    },
    execution: {
      status: partialReasons.length === 0 ? "complete" : "partial",
      partialReasons,
      transportBodyBytes: transportResult.execution.bodyBytes,
      contextSignals: context.execution.emittedSignals,
      productFindings: product.inbox.execution.emittedFindings,
      aiFindings: ai.inbox.execution.emittedFindings,
      emittedFindings: inbox.execution.emittedFindings,
    },
    transport: stripTransportJson(transportResult),
    context,
    product,
    ai,
    inbox,
  };
}
