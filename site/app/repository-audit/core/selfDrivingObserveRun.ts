import {
  createSolveInbox,
  type ScoutFindingInput,
  type SelfDrivingMode,
  type SolveInbox,
  type SolveInboxItem,
} from "./selfDriving";
import {
  analyzeAiContext,
  type AiScoutAnalysis,
  type AiScoutBudgetPolicy,
} from "./selfDrivingAiScout";
import type { SolveContextSnapshot } from "./selfDrivingContext";
import {
  analyzeProductContext,
  type ExperienceScoutBudgets,
  type ProductScoutAnalysis,
  type RolloutScoutBudgets,
} from "./selfDrivingProductScouts";

export type SelfDrivingObserveRunOptions = {
  requestedMode?: SelfDrivingMode;
  aiBudgets?: AiScoutBudgetPolicy;
  experienceBudgets?: ExperienceScoutBudgets;
  rolloutBudgets?: RolloutScoutBudgets;
  maxFindings?: number;
};

export type SelfDrivingObserveRun = {
  schema: "solvelang.self-driving.observe-run.v0";
  mode: "analyze-only";
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    explicitEvidenceOnly: true;
    callerSuppliedBudgetsOnly: true;
    causalityInference: false;
    providerAccess: false;
    networkAccess: false;
    credentialAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  limits: {
    maxContextSignals: number;
    componentMaxFindings: number;
    maxFindings: number;
  };
  sourceContext: {
    schema: SolveContextSnapshot["schema"];
    status: SolveContextSnapshot["execution"]["status"];
    truncated: boolean;
    truncationReasons: SolveContextSnapshot["execution"]["truncationReasons"];
    emittedSignals: number;
  };
  budgets: {
    ai: AiScoutBudgetPolicy;
    experience: ExperienceScoutBudgets;
    rollout: RolloutScoutBudgets;
  };
  components: {
    ai: {
      schema: AiScoutAnalysis["schema"];
      status: AiScoutAnalysis["execution"]["status"];
      examinedSignals: number;
      ignoredSignals: number;
      candidateFindings: number;
      emittedFindings: number;
      inboxTruncated: boolean;
    };
    product: {
      schema: ProductScoutAnalysis["schema"];
      status: ProductScoutAnalysis["execution"]["status"];
      examinedSignals: number;
      incidentSignals: number;
      experienceSignals: number;
      rolloutSignals: number;
      candidateFindings: number;
      emittedFindings: number;
      inboxTruncated: boolean;
    };
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<
      | "context-partial"
      | "ai-inbox-truncated"
      | "product-inbox-truncated"
      | "combined-inbox-truncated"
    >;
    candidateFindings: number;
    componentEmittedFindings: number;
    combinedInputFindings: number;
    combinedUniqueFindings: number;
    emittedFindings: number;
  };
  inbox: SolveInbox;
};

export const defaultSelfDrivingObserveRunLimits = Object.freeze({
  maxContextSignals: 500,
  componentMaxFindings: 5_000,
  maxFindings: 200,
});

function inboxItemToFinding(item: SolveInboxItem): ScoutFindingInput {
  return {
    scout: item.scout,
    severity: item.severity,
    title: item.title,
    summary: item.summary,
    impact: item.impact,
    confidence: { ...item.confidence },
    provenance: item.provenance.map((entry) => ({ ...entry })),
    recommendedAction: { ...item.recommendedAction },
  };
}

function assertContextSignalBound(context: SolveContextSnapshot): void {
  if (!context || typeof context !== "object") throw new Error("Solve Context snapshot is required.");
  if (!Array.isArray(context.signals)) throw new Error("Solve Context signals must be an array.");
  if (context.signals.length > defaultSelfDrivingObserveRunLimits.maxContextSignals) {
    throw new Error(
      `Self-Driving Observe Run accepts at most ${defaultSelfDrivingObserveRunLimits.maxContextSignals} emitted Context signals in v0.`,
    );
  }
}

export function runSelfDrivingObserve(
  context: SolveContextSnapshot,
  options: SelfDrivingObserveRunOptions = {},
): SelfDrivingObserveRun {
  assertContextSignalBound(context);

  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`Self-Driving Observe Run mode '${requestedMode}' is not enabled. Observe Run is observe-only.`);
  }

  const ai = analyzeAiContext(context, {
    requestedMode: "observe",
    ...(options.aiBudgets === undefined ? {} : { budgets: options.aiBudgets }),
    maxFindings: defaultSelfDrivingObserveRunLimits.componentMaxFindings,
  });
  const product = analyzeProductContext(context, {
    requestedMode: "observe",
    ...(options.experienceBudgets === undefined ? {} : { experienceBudgets: options.experienceBudgets }),
    ...(options.rolloutBudgets === undefined ? {} : { rolloutBudgets: options.rolloutBudgets }),
    maxFindings: defaultSelfDrivingObserveRunLimits.componentMaxFindings,
  });

  const combinedInputs = [
    ...ai.inbox.items.map(inboxItemToFinding),
    ...product.inbox.items.map(inboxItemToFinding),
  ];
  const maxFindings = options.maxFindings ?? defaultSelfDrivingObserveRunLimits.maxFindings;
  const inbox = createSolveInbox(combinedInputs, {
    requestedMode: "observe",
    maxFindings,
  });

  const partialReasons: SelfDrivingObserveRun["execution"]["partialReasons"] = [];
  if (context.execution.status === "partial" || context.execution.truncated) partialReasons.push("context-partial");
  if (ai.inbox.execution.truncated) partialReasons.push("ai-inbox-truncated");
  if (product.inbox.execution.truncated) partialReasons.push("product-inbox-truncated");
  if (inbox.execution.truncated) partialReasons.push("combined-inbox-truncated");

  return {
    schema: "solvelang.self-driving.observe-run.v0",
    mode: "analyze-only",
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      explicitEvidenceOnly: true,
      callerSuppliedBudgetsOnly: true,
      causalityInference: false,
      providerAccess: false,
      networkAccess: false,
      credentialAccess: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    limits: {
      maxContextSignals: defaultSelfDrivingObserveRunLimits.maxContextSignals,
      componentMaxFindings: defaultSelfDrivingObserveRunLimits.componentMaxFindings,
      maxFindings: inbox.limits.maxFindings,
    },
    sourceContext: {
      schema: context.schema,
      status: context.execution.status,
      truncated: context.execution.truncated,
      truncationReasons: [...context.execution.truncationReasons],
      emittedSignals: context.execution.emittedSignals,
    },
    budgets: {
      ai: { ...ai.budgets },
      experience: { ...product.budgets.experience },
      rollout: { ...product.budgets.rollout },
    },
    components: {
      ai: {
        schema: ai.schema,
        status: ai.execution.status,
        examinedSignals: ai.execution.examinedSignals,
        ignoredSignals: ai.execution.ignoredNonAiSignals,
        candidateFindings: ai.execution.candidateFindings,
        emittedFindings: ai.execution.emittedFindings,
        inboxTruncated: ai.inbox.execution.truncated,
      },
      product: {
        schema: product.schema,
        status: product.execution.status,
        examinedSignals: product.execution.examinedSignals,
        incidentSignals: product.execution.incidentSignals,
        experienceSignals: product.execution.experienceSignals,
        rolloutSignals: product.execution.rolloutSignals,
        candidateFindings: product.execution.candidateFindings,
        emittedFindings: product.execution.emittedFindings,
        inboxTruncated: product.inbox.execution.truncated,
      },
    },
    execution: {
      status: partialReasons.length === 0 ? "complete" : "partial",
      partialReasons,
      candidateFindings: ai.execution.candidateFindings + product.execution.candidateFindings,
      componentEmittedFindings: ai.execution.emittedFindings + product.execution.emittedFindings,
      combinedInputFindings: combinedInputs.length,
      combinedUniqueFindings: inbox.execution.uniqueFindings,
      emittedFindings: inbox.execution.emittedFindings,
    },
    inbox,
  };
}
