import {
  createSolveInbox,
  type ScoutFindingInput,
  type SelfDrivingMode,
  type SolveInbox,
} from "./selfDriving";
import type { SolveContextSignal, SolveContextSnapshot } from "./selfDrivingContext";

export type AiScoutBudgetPolicy = {
  maxMcpAttempts?: number;
  maxLatencyMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
};

export type AiScoutOptions = {
  requestedMode?: SelfDrivingMode;
  budgets?: AiScoutBudgetPolicy;
  maxFindings?: number;
};

export type AiScoutAnalysis = {
  schema: "solvelang.self-driving.ai-scout.v0";
  mode: "analyze-only";
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    explicitEvidenceOnly: true;
    callerSuppliedBudgetsOnly: true;
    rawPromptAccess: false;
    providerAccess: false;
    networkAccess: false;
    credentialAccess: false;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  budgets: AiScoutBudgetPolicy;
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
    ignoredNonAiSignals: number;
    candidateFindings: number;
    emittedFindings: number;
  };
  inbox: SolveInbox;
};

const metricRules = [
  {
    budgetKey: "maxLatencyMs",
    metricKey: "latency_ms",
    title: "AI latency budget exceeded",
    noun: "latency",
    unit: "ms",
    severity: "medium",
  },
  {
    budgetKey: "maxInputTokens",
    metricKey: "input_tokens",
    title: "AI input-token budget exceeded",
    noun: "input-token usage",
    unit: "tokens",
    severity: "low",
  },
  {
    budgetKey: "maxOutputTokens",
    metricKey: "output_tokens",
    title: "AI output-token budget exceeded",
    noun: "output-token usage",
    unit: "tokens",
    severity: "low",
  },
  {
    budgetKey: "maxTotalTokens",
    metricKey: "total_tokens",
    title: "AI total-token budget exceeded",
    noun: "total-token usage",
    unit: "tokens",
    severity: "low",
  },
  {
    budgetKey: "maxCostUsd",
    metricKey: "cost_usd",
    title: "AI cost budget exceeded",
    noun: "cost",
    unit: "USD",
    severity: "medium",
  },
] as const;

type MetricRule = (typeof metricRules)[number];

type AiSignal = SolveContextSignal & { kind: "ai-trace" | "mcp-tool-call" };

function assertPositiveFiniteBudget(value: number | undefined, name: keyof AiScoutBudgetPolicy): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} must be a positive finite value no greater than Number.MAX_SAFE_INTEGER.`);
  }
}

function normalizeBudgets(input: AiScoutBudgetPolicy | undefined): AiScoutBudgetPolicy {
  const budgets = input ?? {};
  for (const key of [
    "maxMcpAttempts",
    "maxLatencyMs",
    "maxInputTokens",
    "maxOutputTokens",
    "maxTotalTokens",
    "maxCostUsd",
  ] as const) {
    assertPositiveFiniteBudget(budgets[key], key);
  }

  if (budgets.maxMcpAttempts !== undefined && !Number.isSafeInteger(budgets.maxMcpAttempts)) {
    throw new Error("maxMcpAttempts must be a positive safe integer.");
  }

  return {
    ...(budgets.maxMcpAttempts === undefined ? {} : { maxMcpAttempts: budgets.maxMcpAttempts }),
    ...(budgets.maxLatencyMs === undefined ? {} : { maxLatencyMs: budgets.maxLatencyMs }),
    ...(budgets.maxInputTokens === undefined ? {} : { maxInputTokens: budgets.maxInputTokens }),
    ...(budgets.maxOutputTokens === undefined ? {} : { maxOutputTokens: budgets.maxOutputTokens }),
    ...(budgets.maxTotalTokens === undefined ? {} : { maxTotalTokens: budgets.maxTotalTokens }),
    ...(budgets.maxCostUsd === undefined ? {} : { maxCostUsd: budgets.maxCostUsd }),
  };
}

function assertSafeContext(context: SolveContextSnapshot): void {
  if (!context || typeof context !== "object") throw new Error("Solve Context snapshot is required.");
  if (context.schema !== "solvelang.self-driving.context.v0") {
    throw new Error("AI Scout requires solvelang.self-driving.context.v0 evidence.");
  }
  if (context.mode !== "analyze-only") throw new Error("AI Scout accepts analyze-only Solve Context evidence only.");
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
    throw new Error("AI Scout requires the safe observe-only Solve Context policy boundary.");
  }
  if (!Array.isArray(context.signals)) throw new Error("Solve Context signals must be an array.");
  for (const signal of context.signals) {
    if (!signal || typeof signal !== "object" || signal.sanitized !== true) {
      throw new Error("AI Scout accepts sanitized Solve Context signals only.");
    }
  }
}

function isAiSignal(signal: SolveContextSignal): signal is AiSignal {
  return signal.kind === "ai-trace" || signal.kind === "mcp-tool-call";
}

function outcome(signal: AiSignal): string | undefined {
  const value = signal.dimensions.outcome;
  return typeof value === "string" ? value : undefined;
}

function provenance(signal: AiSignal) {
  return [{
    kind: signal.kind,
    locator: signal.locator,
    ...(signal.revision === undefined ? {} : { revision: signal.revision }),
    note: `Sanitized Solve Context signal ${signal.id} from ${signal.source}, observed ${signal.observedAt}.`,
  }] as const;
}

function explicitFailureFinding(signal: AiSignal): ScoutFindingInput | null {
  if (signal.kind !== "ai-trace" || outcome(signal) !== "failure") return null;
  return {
    scout: "ai",
    severity: "medium",
    title: "AI trace reported an explicit failure",
    summary: "A sanitized AI trace explicitly records outcome=failure. AI Scout is reporting that direct signal without inferring a root cause.",
    impact: "The failed AI operation may affect reliability for the represented trace; inspect the linked sanitized evidence before changing code, prompts, tools, or models.",
    confidence: {
      score: 1,
      basis: "The sanitized Solve Context dimension explicitly records outcome=failure.",
    },
    provenance: [...provenance(signal)],
    recommendedAction: {
      kind: "inspect",
      label: "Inspect failed AI trace",
    },
  };
}

function repeatedMcpFailureFinding(signal: AiSignal, budgets: AiScoutBudgetPolicy): ScoutFindingInput | null {
  if (signal.kind !== "mcp-tool-call" || outcome(signal) !== "failure" || budgets.maxMcpAttempts === undefined) return null;
  const attempts = signal.metrics.attempts;
  if (!Number.isFinite(attempts) || attempts <= budgets.maxMcpAttempts) return null;
  return {
    scout: "ai",
    severity: "medium",
    title: "Failed MCP tool-call retry budget exceeded",
    summary: `A sanitized MCP tool-call signal explicitly records outcome=failure and ${attempts} attempts, exceeding the caller-supplied budget of ${budgets.maxMcpAttempts}.`,
    impact: "Repeated failed tool calls can increase latency and resource use. The finding does not infer why the tool failed or whether retry behavior should change.",
    confidence: {
      score: 1,
      basis: "The finding compares an explicit sanitized failure outcome and attempts metric with a caller-supplied retry budget.",
    },
    provenance: [...provenance(signal)],
    recommendedAction: {
      kind: "inspect",
      label: "Inspect MCP retry evidence",
    },
  };
}

function metricBudgetFinding(signal: AiSignal, budgets: AiScoutBudgetPolicy, rule: MetricRule): ScoutFindingInput | null {
  const budget = budgets[rule.budgetKey];
  if (budget === undefined) return null;
  const observed = signal.metrics[rule.metricKey];
  if (!Number.isFinite(observed) || observed <= budget) return null;

  return {
    scout: rule.budgetKey === "maxCostUsd" || rule.budgetKey.includes("Tokens") ? "cost" : "ai",
    severity: rule.severity,
    title: rule.title,
    summary: `A sanitized ${signal.kind} signal reports ${rule.noun} of ${observed} ${rule.unit}, exceeding the caller-supplied budget of ${budget} ${rule.unit}.`,
    impact: `The supplied ${rule.noun} budget was exceeded for this signal. AI Scout does not infer an optimization, regression baseline, or root cause from the breach alone.`,
    confidence: {
      score: 1,
      basis: `The finding directly compares the sanitized ${rule.metricKey} metric with the caller-supplied ${rule.budgetKey} threshold.`,
    },
    provenance: [...provenance(signal)],
    recommendedAction: {
      kind: "inspect",
      label: `Inspect ${rule.noun} evidence`,
    },
  };
}

function collectFindings(signals: AiSignal[], budgets: AiScoutBudgetPolicy): ScoutFindingInput[] {
  const findings: ScoutFindingInput[] = [];
  for (const signal of signals) {
    const explicitFailure = explicitFailureFinding(signal);
    if (explicitFailure) findings.push(explicitFailure);

    const repeatedFailure = repeatedMcpFailureFinding(signal, budgets);
    if (repeatedFailure) findings.push(repeatedFailure);

    for (const rule of metricRules) {
      const finding = metricBudgetFinding(signal, budgets, rule);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

export function analyzeAiContext(
  context: SolveContextSnapshot,
  options: AiScoutOptions = {},
): AiScoutAnalysis {
  assertSafeContext(context);

  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`AI Scout mode '${requestedMode}' is not enabled. AI Scout is observe-only.`);
  }

  const budgets = normalizeBudgets(options.budgets);
  const aiSignals = context.signals.filter(isAiSignal);
  const findings = collectFindings(aiSignals, budgets);
  const inbox = createSolveInbox(findings, {
    requestedMode: "observe",
    ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
  });

  const partialReasons: AiScoutAnalysis["execution"]["partialReasons"] = [];
  if (context.execution.truncated || context.execution.status === "partial") partialReasons.push("context-truncated");
  if (inbox.execution.truncated || inbox.execution.status === "partial") partialReasons.push("inbox-truncated");

  return {
    schema: "solvelang.self-driving.ai-scout.v0",
    mode: "analyze-only",
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      explicitEvidenceOnly: true,
      callerSuppliedBudgetsOnly: true,
      rawPromptAccess: false,
      providerAccess: false,
      networkAccess: false,
      credentialAccess: false,
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    budgets,
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
      examinedSignals: aiSignals.length,
      ignoredNonAiSignals: context.signals.length - aiSignals.length,
      candidateFindings: findings.length,
      emittedFindings: inbox.execution.emittedFindings,
    },
    inbox,
  };
}
