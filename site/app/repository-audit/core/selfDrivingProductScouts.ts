import {
  createSolveInbox,
  type ScoutFindingInput,
  type SelfDrivingMode,
  type SolveInbox,
} from "./selfDriving";
import type { SolveContextSignal, SolveContextSnapshot } from "./selfDrivingContext";

export type ExperienceScoutBudgets = {
  minConversionRate?: number;
  maxAbandonmentRate?: number;
  maxP95LatencyMs?: number;
};

export type RolloutScoutBudgets = {
  maxErrorRate?: number;
  minConversionRate?: number;
  maxP95LatencyMs?: number;
};

export type ProductScoutOptions = {
  requestedMode?: SelfDrivingMode;
  experienceBudgets?: ExperienceScoutBudgets;
  rolloutBudgets?: RolloutScoutBudgets;
  maxFindings?: number;
};

export type ProductScoutAnalysis = {
  schema: "solvelang.self-driving.product-scouts.v0";
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
  budgets: {
    experience: ExperienceScoutBudgets;
    rollout: RolloutScoutBudgets;
  };
  sourceContext: {
    schema: SolveContextSnapshot["schema"];
    status: SolveContextSnapshot["execution"]["status"];
    truncated: boolean;
    truncationReasons: SolveContextSnapshot["execution"]["truncationReasons"];
    emittedSignals: number;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"context-truncated" | "inbox-truncated">;
    examinedSignals: number;
    incidentSignals: number;
    experienceSignals: number;
    rolloutSignals: number;
    candidateFindings: number;
    emittedFindings: number;
  };
  inbox: SolveInbox;
};

type ExperienceSignal = SolveContextSignal & {
  kind: "runtime-event" | "support" | "warehouse" | "feature-flag" | "experiment";
};

type RolloutSignal = SolveContextSignal & {
  kind: "deployment" | "feature-flag" | "experiment";
};

const experienceKinds = new Set<SolveContextSignal["kind"]>([
  "runtime-event",
  "support",
  "warehouse",
  "feature-flag",
  "experiment",
]);

const rolloutKinds = new Set<SolveContextSignal["kind"]>([
  "deployment",
  "feature-flag",
  "experiment",
]);

function assertSafeContext(context: SolveContextSnapshot): void {
  if (!context || typeof context !== "object") throw new Error("Solve Context snapshot is required.");
  if (context.schema !== "solvelang.self-driving.context.v0") {
    throw new Error("Product Scouts require solvelang.self-driving.context.v0 evidence.");
  }
  if (context.mode !== "analyze-only") {
    throw new Error("Product Scouts accept analyze-only Solve Context evidence only.");
  }
  if (
    context.policy.requestedMode !== "observe"
    || context.policy.effectiveMode !== "observe"
    || context.policy.sanitizedOnly !== true
    || context.policy.networkAccess !== false
    || context.policy.credentialAccess !== false
    || context.policy.repositoryWriteAccess !== false
    || context.policy.productionMutationAccess !== false
    || context.policy.externalSideEffects !== false
  ) {
    throw new Error("Product Scouts require the safe observe-only Solve Context policy boundary.");
  }
  if (!Array.isArray(context.signals)) throw new Error("Solve Context signals must be an array.");
  for (const signal of context.signals) {
    if (!signal || typeof signal !== "object" || signal.sanitized !== true) {
      throw new Error("Product Scouts accept sanitized Solve Context signals only.");
    }
  }
}

function assertRate(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite rate between 0 and 1.`);
  }
}

function assertPositiveFinite(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be a positive finite value no greater than Number.MAX_SAFE_INTEGER.`);
  }
}

function normalizeExperienceBudgets(input: ExperienceScoutBudgets | undefined): ExperienceScoutBudgets {
  const budgets = input ?? {};
  assertRate(budgets.minConversionRate, "experienceBudgets.minConversionRate");
  assertRate(budgets.maxAbandonmentRate, "experienceBudgets.maxAbandonmentRate");
  assertPositiveFinite(budgets.maxP95LatencyMs, "experienceBudgets.maxP95LatencyMs");
  return {
    ...(budgets.minConversionRate === undefined ? {} : { minConversionRate: budgets.minConversionRate }),
    ...(budgets.maxAbandonmentRate === undefined ? {} : { maxAbandonmentRate: budgets.maxAbandonmentRate }),
    ...(budgets.maxP95LatencyMs === undefined ? {} : { maxP95LatencyMs: budgets.maxP95LatencyMs }),
  };
}

function normalizeRolloutBudgets(input: RolloutScoutBudgets | undefined): RolloutScoutBudgets {
  const budgets = input ?? {};
  assertRate(budgets.maxErrorRate, "rolloutBudgets.maxErrorRate");
  assertRate(budgets.minConversionRate, "rolloutBudgets.minConversionRate");
  assertPositiveFinite(budgets.maxP95LatencyMs, "rolloutBudgets.maxP95LatencyMs");
  return {
    ...(budgets.maxErrorRate === undefined ? {} : { maxErrorRate: budgets.maxErrorRate }),
    ...(budgets.minConversionRate === undefined ? {} : { minConversionRate: budgets.minConversionRate }),
    ...(budgets.maxP95LatencyMs === undefined ? {} : { maxP95LatencyMs: budgets.maxP95LatencyMs }),
  };
}

function dimension(signal: SolveContextSignal, key: string): string | undefined {
  const value = signal.dimensions[key];
  return typeof value === "string" ? value : undefined;
}

function provenance(signal: SolveContextSignal) {
  return [{
    kind: signal.kind,
    locator: signal.locator,
    ...(signal.revision === undefined ? {} : { revision: signal.revision }),
    note: `Sanitized Solve Context signal ${signal.id} from ${signal.source}, observed ${signal.observedAt}.`,
  }] as const;
}

function incidentFinding(signal: SolveContextSignal): ScoutFindingInput | null {
  let directBasis: string | null = null;
  if (signal.kind === "error") {
    directBasis = "The provider-neutral Context signal kind is explicitly error.";
  } else if (signal.kind === "trace" && dimension(signal, "outcome") === "failure") {
    directBasis = "The sanitized trace dimension explicitly records outcome=failure.";
  } else if (
    signal.kind === "log"
    && (dimension(signal, "level") === "error" || dimension(signal, "severity") === "error")
  ) {
    directBasis = "The sanitized log dimension explicitly records error level/severity.";
  }

  if (directBasis === null) return null;
  return {
    scout: "incident",
    severity: "medium",
    title: "Product incident evidence requires inspection",
    summary: "A sanitized runtime signal contains explicit error/failure evidence. Incident Scout reports that evidence without inferring a root cause or affected customer scope.",
    impact: "The signal may represent a product reliability problem. Inspect the sanitized evidence and related repository/deployment context before proposing a change.",
    confidence: {
      score: 1,
      basis: directBasis,
    },
    provenance: [...provenance(signal)],
    recommendedAction: {
      kind: "inspect",
      label: "Inspect incident evidence",
    },
  };
}

function failedDeploymentFinding(signal: RolloutSignal): ScoutFindingInput | null {
  if (signal.kind !== "deployment" || dimension(signal, "outcome") !== "failure") return null;
  return {
    scout: "rollout",
    severity: "medium",
    title: "Deployment reported an explicit failure",
    summary: "A sanitized deployment signal explicitly records outcome=failure. Rollout Scout reports the failed rollout evidence without attributing downstream product changes to it.",
    impact: "The represented deployment did not report success. Inspect deployment evidence before expanding, retrying, or changing rollout state.",
    confidence: {
      score: 1,
      basis: "The sanitized deployment dimension explicitly records outcome=failure.",
    },
    provenance: [...provenance(signal)],
    recommendedAction: {
      kind: "inspect",
      label: "Inspect failed deployment",
    },
  };
}

function isExperienceSignal(signal: SolveContextSignal): signal is ExperienceSignal {
  return experienceKinds.has(signal.kind);
}

function isRolloutSignal(signal: SolveContextSignal): signal is RolloutSignal {
  return rolloutKinds.has(signal.kind);
}

function experienceBudgetFindings(
  signal: ExperienceSignal,
  budgets: ExperienceScoutBudgets,
): ScoutFindingInput[] {
  const findings: ScoutFindingInput[] = [];

  const conversion = signal.metrics.conversion_rate;
  if (
    budgets.minConversionRate !== undefined
    && Number.isFinite(conversion)
    && conversion < budgets.minConversionRate
  ) {
    findings.push({
      scout: "experience",
      severity: "medium",
      title: "Experience conversion budget missed",
      summary: `A sanitized ${signal.kind} signal reports conversion_rate=${conversion}, below the caller-supplied minimum of ${budgets.minConversionRate}.`,
      impact: "The supplied conversion objective was not met for this signal. The finding does not infer why conversion changed or whether a code change caused it.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized conversion_rate evidence with a caller-supplied minimum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect conversion evidence" },
    });
  }

  const abandonment = signal.metrics.abandonment_rate;
  if (
    budgets.maxAbandonmentRate !== undefined
    && Number.isFinite(abandonment)
    && abandonment > budgets.maxAbandonmentRate
  ) {
    findings.push({
      scout: "experience",
      severity: "medium",
      title: "Experience abandonment budget exceeded",
      summary: `A sanitized ${signal.kind} signal reports abandonment_rate=${abandonment}, above the caller-supplied maximum of ${budgets.maxAbandonmentRate}.`,
      impact: "The supplied abandonment objective was exceeded for this signal. Inspect the product flow and related evidence before attributing a cause.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized abandonment_rate evidence with a caller-supplied maximum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect abandonment evidence" },
    });
  }

  const p95Latency = signal.metrics.p95_latency_ms;
  if (
    budgets.maxP95LatencyMs !== undefined
    && Number.isFinite(p95Latency)
    && p95Latency > budgets.maxP95LatencyMs
  ) {
    findings.push({
      scout: "experience",
      severity: "medium",
      title: "Experience latency budget exceeded",
      summary: `A sanitized ${signal.kind} signal reports p95_latency_ms=${p95Latency}, above the caller-supplied maximum of ${budgets.maxP95LatencyMs} ms.`,
      impact: "The supplied experience latency objective was exceeded. The finding does not infer which component caused the latency.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized p95_latency_ms evidence with a caller-supplied maximum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect experience latency" },
    });
  }

  return findings;
}

function rolloutBudgetFindings(
  signal: RolloutSignal,
  budgets: RolloutScoutBudgets,
): ScoutFindingInput[] {
  const findings: ScoutFindingInput[] = [];

  const errorRate = signal.metrics.error_rate;
  if (
    budgets.maxErrorRate !== undefined
    && Number.isFinite(errorRate)
    && errorRate > budgets.maxErrorRate
  ) {
    findings.push({
      scout: "rollout",
      severity: "medium",
      title: "Rollout error-rate budget exceeded",
      summary: `A sanitized ${signal.kind} signal reports error_rate=${errorRate}, above the caller-supplied maximum of ${budgets.maxErrorRate}.`,
      impact: "The supplied rollout error-rate objective was exceeded for this signal. Rollout Scout does not infer that the rollout caused the errors.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized error_rate evidence with a caller-supplied rollout maximum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect rollout error rate" },
    });
  }

  const conversion = signal.metrics.conversion_rate;
  if (
    budgets.minConversionRate !== undefined
    && Number.isFinite(conversion)
    && conversion < budgets.minConversionRate
  ) {
    findings.push({
      scout: "rollout",
      severity: "medium",
      title: "Rollout conversion budget missed",
      summary: `A sanitized ${signal.kind} signal reports conversion_rate=${conversion}, below the caller-supplied rollout minimum of ${budgets.minConversionRate}.`,
      impact: "The supplied rollout conversion objective was not met for this signal. This is correlation evidence only, not proof that the rollout caused the metric.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized conversion_rate evidence with a caller-supplied rollout minimum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect rollout conversion" },
    });
  }

  const p95Latency = signal.metrics.p95_latency_ms;
  if (
    budgets.maxP95LatencyMs !== undefined
    && Number.isFinite(p95Latency)
    && p95Latency > budgets.maxP95LatencyMs
  ) {
    findings.push({
      scout: "rollout",
      severity: "medium",
      title: "Rollout latency budget exceeded",
      summary: `A sanitized ${signal.kind} signal reports p95_latency_ms=${p95Latency}, above the caller-supplied rollout maximum of ${budgets.maxP95LatencyMs} ms.`,
      impact: "The supplied rollout latency objective was exceeded for this signal. The finding does not establish a causal relationship with the rollout.",
      confidence: {
        score: 1,
        basis: "The finding directly compares sanitized p95_latency_ms evidence with a caller-supplied rollout maximum.",
      },
      provenance: [...provenance(signal)],
      recommendedAction: { kind: "inspect", label: "Inspect rollout latency" },
    });
  }

  return findings;
}

export function analyzeProductContext(
  context: SolveContextSnapshot,
  options: ProductScoutOptions = {},
): ProductScoutAnalysis {
  assertSafeContext(context);

  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`Product Scout mode '${requestedMode}' is not enabled. Product Scouts are observe-only.`);
  }

  const experienceBudgets = normalizeExperienceBudgets(options.experienceBudgets);
  const rolloutBudgets = normalizeRolloutBudgets(options.rolloutBudgets);
  const findings: ScoutFindingInput[] = [];
  let incidentSignals = 0;
  let experienceSignals = 0;
  let rolloutSignals = 0;

  for (const signal of context.signals) {
    const incident = incidentFinding(signal);
    if (incident !== null) {
      incidentSignals += 1;
      findings.push(incident);
    }

    if (isExperienceSignal(signal)) {
      experienceSignals += 1;
      findings.push(...experienceBudgetFindings(signal, experienceBudgets));
    }

    if (isRolloutSignal(signal)) {
      rolloutSignals += 1;
      const failedDeployment = failedDeploymentFinding(signal);
      if (failedDeployment !== null) findings.push(failedDeployment);
      findings.push(...rolloutBudgetFindings(signal, rolloutBudgets));
    }
  }

  const inbox = createSolveInbox(findings, {
    requestedMode: "observe",
    ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
  });

  const partialReasons: ProductScoutAnalysis["execution"]["partialReasons"] = [];
  if (context.execution.truncated || context.execution.status === "partial") partialReasons.push("context-truncated");
  if (inbox.execution.truncated || inbox.execution.status === "partial") partialReasons.push("inbox-truncated");

  return {
    schema: "solvelang.self-driving.product-scouts.v0",
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
    budgets: {
      experience: experienceBudgets,
      rollout: rolloutBudgets,
    },
    sourceContext: {
      schema: context.schema,
      status: context.execution.status,
      truncated: context.execution.truncated,
      truncationReasons: [...context.execution.truncationReasons],
      emittedSignals: context.execution.emittedSignals,
    },
    execution: {
      status: partialReasons.length === 0 ? "complete" : "partial",
      partialReasons,
      examinedSignals: context.signals.length,
      incidentSignals,
      experienceSignals,
      rolloutSignals,
      candidateFindings: findings.length,
      emittedFindings: inbox.execution.emittedFindings,
    },
    inbox,
  };
}
