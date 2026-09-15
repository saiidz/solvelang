import { sha256Text } from "./context-pack.js";

export const CONTEXT_AGENT_EVAL_RECORD_SCHEMA = "solvelang.context.agent-eval-record.v0" as const;
export const CONTEXT_AGENT_EVAL_REPORT_SCHEMA = "solvelang.context.agent-eval-report.v0" as const;
export const CONTEXT_AGENT_EVAL_CATEGORIES = [
  "monorepo-bug-fix",
  "github-issue-triage",
  "ci-log-diagnosis",
  "multi-file-refactor",
  "json-heavy-tool-output",
  "cross-agent-handoff",
] as const;

export type ContextAgentEvalCategory = typeof CONTEXT_AGENT_EVAL_CATEGORIES[number];
export type ContextAgentEvalAgent = "claude" | "codex";
export type ContextAgentEvalVariant = "baseline" | "solve_context";
export type ContextAgentEvalRecordClass = "measured-run" | "synthetic-test";
export type ContextAgentOutcomeBasis = "human-reviewed" | "deterministic-check" | "synthetic";
export type ContextAgentTokenBasis = "provider-reported" | "local-tokenizer" | "estimated" | "unavailable" | "synthetic";
export type ContextAgentMeasurementBasis = "measured" | "estimated" | "unavailable" | "synthetic";

export interface ContextAgentEvalRecord {
  schema: typeof CONTEXT_AGENT_EVAL_RECORD_SCHEMA;
  suiteId: string;
  pairId: string;
  fixture: {
    id: string;
    category: ContextAgentEvalCategory;
    revisionSha256: string;
  };
  agent: ContextAgentEvalAgent;
  variant: ContextAgentEvalVariant;
  provider: {
    name: string;
    model: string;
  };
  recordClass: ContextAgentEvalRecordClass;
  outcome: {
    taskSuccess: boolean;
    basis: ContextAgentOutcomeBasis;
    evidenceRequired: number;
    evidenceRetained: number;
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    basis: ContextAgentTokenBasis;
    tokenizer: string | null;
  };
  latency: {
    wallMs: number | null;
    basis: ContextAgentMeasurementBasis;
  };
  context: {
    packId: string | null;
    selectedBytes: number | null;
    cacheHotBytesChanged: number | null;
    cacheHotBytesChangedBasis: ContextAgentMeasurementBasis;
  };
}

export interface ContextAgentEvalRecordIdentity extends ContextAgentEvalRecord {
  recordSha256: string;
}

export interface ContextAgentEvalPairReport {
  suiteId: string;
  pairId: string;
  fixture: ContextAgentEvalRecord["fixture"];
  agent: ContextAgentEvalAgent;
  provider: ContextAgentEvalRecord["provider"];
  measuredPair: boolean;
  baselineRecordSha256: string;
  contextRecordSha256: string;
  quality: {
    baselineTaskSuccess: boolean;
    contextTaskSuccess: boolean;
    baselineEvidenceRecall: number;
    contextEvidenceRecall: number;
    nonRegression: boolean;
  };
  providerTokens: {
    comparable: boolean;
    baselineInputTokens: number | null;
    contextInputTokens: number | null;
    inputDelta: number | null;
    inputDeltaPercent: number | null;
    baselineOutputTokens: number | null;
    contextOutputTokens: number | null;
    outputDelta: number | null;
    baselineCacheReadTokens: number | null;
    contextCacheReadTokens: number | null;
  };
  localTokenizer: {
    comparable: boolean;
    tokenizer: string | null;
    baselineInputTokens: number | null;
    contextInputTokens: number | null;
    inputDelta: number | null;
    inputDeltaPercent: number | null;
  };
  estimatedTokens: {
    comparable: boolean;
    estimator: string | null;
    baselineInputTokens: number | null;
    contextInputTokens: number | null;
    inputDelta: number | null;
    inputDeltaPercent: number | null;
  };
  latency: {
    comparable: boolean;
    baselineWallMs: number | null;
    contextWallMs: number | null;
    wallDeltaMs: number | null;
  };
  fidelity: {
    contextCacheHotBytesChanged: number | null;
    contextCacheHotBytesChangedBasis: ContextAgentMeasurementBasis;
    measuredZeroCacheHotMutation: boolean | null;
  };
  context: {
    packId: string | null;
    selectedBytes: number | null;
  };
}

export interface ContextAgentEvalReport {
  schema: typeof CONTEXT_AGENT_EVAL_REPORT_SCHEMA;
  reportId: string;
  truth: {
    providerRequestsPerformedByHarness: 0;
    credentialsUsedByHarness: false;
    syntheticRecordsExcludedFromMeasuredAggregates: true;
    estimatedTokensAreNotProviderTokens: true;
    localTokenizerCountsAreNotProviderTokens: true;
    publicationAuthorized: false;
    publicPercentageClaimAllowed: false;
  };
  coverage: {
    categories: Array<{ category: ContextAgentEvalCategory; measuredPairs: number }>;
    missingCategories: ContextAgentEvalCategory[];
    acceptanceCategoryCoverageComplete: boolean;
    agents: Array<{ agent: ContextAgentEvalAgent; measuredPairs: number }>;
  };
  aggregate: {
    pairCount: number;
    measuredPairCount: number;
    syntheticPairCount: number;
    qualityGatePassed: boolean | null;
    qualityRegressionPairs: string[];
    providerTokenPairCount: number;
    measuredBaselineInputTokens: number | null;
    measuredContextInputTokens: number | null;
    measuredInputTokenDelta: number | null;
    measuredInputTokenDeltaPercent: number | null;
    measuredLatencyPairCount: number;
    meanBaselineWallMs: number | null;
    meanContextWallMs: number | null;
    meanWallDeltaMs: number | null;
    measuredZeroCacheHotMutationPairCount: number;
    benchmarkEvidenceComplete: boolean;
  };
  pairs: ContextAgentEvalPairReport[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PACK_ID = /^scp_[a-f0-9]{32}$/;
const MAX_LABEL_BYTES = 512;
const MAX_METRIC = 1_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) assert(allowedSet.has(key), `${label} contains unknown field ${key}.`);
  for (const key of allowed) assert(Object.hasOwn(value, key), `${label} is missing ${key}.`);
}

function boundedString(value: unknown, label: string, pattern?: RegExp): string {
  assert(typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= MAX_LABEL_BYTES, `${label} is invalid.`);
  assert(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains control characters.`);
  if (pattern) assert(pattern.test(value), `${label} has an invalid format.`);
  return value;
}

function nullableMetric(value: unknown, label: string): number | null {
  if (value === null) return null;
  assert(Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_METRIC, `${label} is invalid.`);
  return value as number;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  assert(typeof value === "string" && (allowed as readonly string[]).includes(value), `${label} is invalid.`);
  return value as T;
}

function evidenceRecall(record: ContextAgentEvalRecord): number {
  return record.outcome.evidenceRequired === 0 ? 1 : record.outcome.evidenceRetained / record.outcome.evidenceRequired;
}

function deltaPercent(baseline: number, context: number): number | null {
  if (baseline === 0) return null;
  return ((context - baseline) / baseline) * 100;
}

function sameProvider(left: ContextAgentEvalRecord, right: ContextAgentEvalRecord): boolean {
  return left.provider.name === right.provider.name && left.provider.model === right.provider.model;
}

function normalizeRecord(value: unknown): ContextAgentEvalRecord {
  assert(isRecord(value), "Agent eval record must be an object.");
  assertExactKeys(value, ["schema", "suiteId", "pairId", "fixture", "agent", "variant", "provider", "recordClass", "outcome", "usage", "latency", "context"], "Agent eval record");
  assert(value.schema === CONTEXT_AGENT_EVAL_RECORD_SCHEMA, "Agent eval record schema is invalid.");

  assert(isRecord(value.fixture), "fixture must be an object.");
  assertExactKeys(value.fixture, ["id", "category", "revisionSha256"], "fixture");
  const fixture = {
    id: boundedString(value.fixture.id, "fixture.id", SAFE_ID),
    category: enumValue(value.fixture.category, CONTEXT_AGENT_EVAL_CATEGORIES, "fixture.category"),
    revisionSha256: boundedString(value.fixture.revisionSha256, "fixture.revisionSha256", SHA256),
  };

  assert(isRecord(value.provider), "provider must be an object.");
  assertExactKeys(value.provider, ["name", "model"], "provider");
  const provider = {
    name: boundedString(value.provider.name, "provider.name"),
    model: boundedString(value.provider.model, "provider.model"),
  };

  assert(isRecord(value.outcome), "outcome must be an object.");
  assertExactKeys(value.outcome, ["taskSuccess", "basis", "evidenceRequired", "evidenceRetained"], "outcome");
  assert(typeof value.outcome.taskSuccess === "boolean", "outcome.taskSuccess must be boolean.");
  const outcomeBasis = enumValue(value.outcome.basis, ["human-reviewed", "deterministic-check", "synthetic"] as const, "outcome.basis");
  const evidenceRequired = nullableMetric(value.outcome.evidenceRequired, "outcome.evidenceRequired");
  const evidenceRetained = nullableMetric(value.outcome.evidenceRetained, "outcome.evidenceRetained");
  assert(evidenceRequired !== null && evidenceRetained !== null && evidenceRetained <= evidenceRequired, "Outcome evidence counts are invalid.");

  assert(isRecord(value.usage), "usage must be an object.");
  assertExactKeys(value.usage, ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "basis", "tokenizer"], "usage");
  const usageBasis = enumValue(value.usage.basis, ["provider-reported", "local-tokenizer", "estimated", "unavailable", "synthetic"] as const, "usage.basis");
  const inputTokens = nullableMetric(value.usage.inputTokens, "usage.inputTokens");
  const outputTokens = nullableMetric(value.usage.outputTokens, "usage.outputTokens");
  const cacheReadTokens = nullableMetric(value.usage.cacheReadTokens, "usage.cacheReadTokens");
  const cacheWriteTokens = nullableMetric(value.usage.cacheWriteTokens, "usage.cacheWriteTokens");
  const tokenizer = value.usage.tokenizer === null ? null : boundedString(value.usage.tokenizer, "usage.tokenizer");
  if (usageBasis === "provider-reported") {
    assert(inputTokens !== null && outputTokens !== null && tokenizer === null, "Provider-reported usage requires input/output tokens and no local tokenizer label.");
  } else if (usageBasis === "local-tokenizer" || usageBasis === "estimated") {
    assert(inputTokens !== null && outputTokens !== null && tokenizer !== null, `${usageBasis} usage requires input/output tokens and a tokenizer/estimator label.`);
    assert(cacheReadTokens === null && cacheWriteTokens === null, `${usageBasis} usage cannot claim provider cache tokens.`);
  } else if (usageBasis === "unavailable") {
    assert(inputTokens === null && outputTokens === null && cacheReadTokens === null && cacheWriteTokens === null && tokenizer === null, "Unavailable usage must contain only null metrics.");
  } else {
    assert(inputTokens !== null && outputTokens !== null && cacheReadTokens === null && cacheWriteTokens === null, "Synthetic usage requires input/output fixture values and cannot claim provider cache tokens.");
  }

  assert(isRecord(value.latency), "latency must be an object.");
  assertExactKeys(value.latency, ["wallMs", "basis"], "latency");
  const latencyBasis = enumValue(value.latency.basis, ["measured", "estimated", "unavailable", "synthetic"] as const, "latency.basis");
  const wallMs = nullableMetric(value.latency.wallMs, "latency.wallMs");
  if (latencyBasis === "unavailable") assert(wallMs === null, "Unavailable latency must be null.");
  else assert(wallMs !== null, `${latencyBasis} latency requires wallMs.`);

  assert(isRecord(value.context), "context must be an object.");
  assertExactKeys(value.context, ["packId", "selectedBytes", "cacheHotBytesChanged", "cacheHotBytesChangedBasis"], "context");
  const packId = value.context.packId === null ? null : boundedString(value.context.packId, "context.packId", PACK_ID);
  const selectedBytes = nullableMetric(value.context.selectedBytes, "context.selectedBytes");
  const cacheHotBytesChanged = nullableMetric(value.context.cacheHotBytesChanged, "context.cacheHotBytesChanged");
  const cacheHotBytesChangedBasis = enumValue(value.context.cacheHotBytesChangedBasis, ["measured", "estimated", "unavailable", "synthetic"] as const, "context.cacheHotBytesChangedBasis");
  if (cacheHotBytesChangedBasis === "unavailable") assert(cacheHotBytesChanged === null, "Unavailable cache-hot byte evidence must be null.");
  else assert(cacheHotBytesChanged !== null, `${cacheHotBytesChangedBasis} cache-hot byte evidence requires a value.`);

  const recordClass = enumValue(value.recordClass, ["measured-run", "synthetic-test"] as const, "recordClass");
  if (recordClass === "measured-run") {
    assert(outcomeBasis !== "synthetic" && usageBasis !== "synthetic" && latencyBasis !== "synthetic" && cacheHotBytesChangedBasis !== "synthetic", "Measured runs cannot contain synthetic evidence bases.");
  } else {
    assert(outcomeBasis === "synthetic", "Synthetic test records must label outcome evidence synthetic.");
    assert(usageBasis === "synthetic" || usageBasis === "unavailable", "Synthetic test token usage must be synthetic or unavailable.");
    assert(latencyBasis === "synthetic" || latencyBasis === "unavailable", "Synthetic test latency must be synthetic or unavailable.");
    assert(cacheHotBytesChangedBasis === "synthetic" || cacheHotBytesChangedBasis === "unavailable", "Synthetic test cache-hot evidence must be synthetic or unavailable.");
  }

  const variant = enumValue(value.variant, ["baseline", "solve_context"] as const, "variant");
  if (variant === "baseline") {
    assert(packId === null && selectedBytes === null, "Baseline records cannot claim a Solve Context pack or selected bytes.");
  } else {
    assert(packId !== null && selectedBytes !== null, "Solve Context records require a packId and selectedBytes.");
  }

  return {
    schema: CONTEXT_AGENT_EVAL_RECORD_SCHEMA,
    suiteId: boundedString(value.suiteId, "suiteId", SAFE_ID),
    pairId: boundedString(value.pairId, "pairId", SAFE_ID),
    fixture,
    agent: enumValue(value.agent, ["claude", "codex"] as const, "agent"),
    variant,
    provider,
    recordClass,
    outcome: {
      taskSuccess: value.outcome.taskSuccess,
      basis: outcomeBasis,
      evidenceRequired,
      evidenceRetained,
    },
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      basis: usageBasis,
      tokenizer,
    },
    latency: { wallMs, basis: latencyBasis },
    context: { packId, selectedBytes, cacheHotBytesChanged, cacheHotBytesChangedBasis },
  };
}

export function validateContextAgentEvalRecord(value: unknown): ContextAgentEvalRecordIdentity {
  const record = normalizeRecord(value);
  return { ...record, recordSha256: sha256Text(JSON.stringify(record)) };
}

function pairReport(baseline: ContextAgentEvalRecordIdentity, context: ContextAgentEvalRecordIdentity): ContextAgentEvalPairReport {
  assert(baseline.suiteId === context.suiteId && baseline.pairId === context.pairId, "Agent eval pair identity does not match.");
  assert(JSON.stringify(baseline.fixture) === JSON.stringify(context.fixture), `Agent eval pair ${baseline.pairId} fixture identity does not match.`);
  assert(baseline.agent === context.agent, `Agent eval pair ${baseline.pairId} agent does not match.`);
  assert(sameProvider(baseline, context), `Agent eval pair ${baseline.pairId} provider/model does not match.`);
  assert(baseline.recordClass === context.recordClass, `Agent eval pair ${baseline.pairId} recordClass does not match.`);

  const baselineRecall = evidenceRecall(baseline);
  const contextRecall = evidenceRecall(context);
  const providerTokensComparable = baseline.recordClass === "measured-run"
    && baseline.usage.basis === "provider-reported"
    && context.usage.basis === "provider-reported";
  const localTokenizerComparable = baseline.recordClass === "measured-run"
    && baseline.usage.basis === "local-tokenizer"
    && context.usage.basis === "local-tokenizer"
    && baseline.usage.tokenizer === context.usage.tokenizer;
  const estimatedTokensComparable = baseline.recordClass === "measured-run"
    && baseline.usage.basis === "estimated"
    && context.usage.basis === "estimated"
    && baseline.usage.tokenizer === context.usage.tokenizer;
  const measuredLatencyComparable = baseline.recordClass === "measured-run"
    && baseline.latency.basis === "measured"
    && context.latency.basis === "measured";

  const tokenView = (comparable: boolean, basis: ContextAgentTokenBasis) => {
    const active = comparable && baseline.usage.basis === basis && context.usage.basis === basis;
    const baselineInput = active ? baseline.usage.inputTokens : null;
    const contextInput = active ? context.usage.inputTokens : null;
    return {
      comparable: active,
      baselineInputTokens: baselineInput,
      contextInputTokens: contextInput,
      inputDelta: baselineInput !== null && contextInput !== null ? contextInput - baselineInput : null,
      inputDeltaPercent: baselineInput !== null && contextInput !== null ? deltaPercent(baselineInput, contextInput) : null,
    };
  };
  const providerView = tokenView(providerTokensComparable, "provider-reported");
  const localView = tokenView(localTokenizerComparable, "local-tokenizer");
  const estimatedView = tokenView(estimatedTokensComparable, "estimated");

  return {
    suiteId: baseline.suiteId,
    pairId: baseline.pairId,
    fixture: baseline.fixture,
    agent: baseline.agent,
    provider: baseline.provider,
    measuredPair: baseline.recordClass === "measured-run",
    baselineRecordSha256: baseline.recordSha256,
    contextRecordSha256: context.recordSha256,
    quality: {
      baselineTaskSuccess: baseline.outcome.taskSuccess,
      contextTaskSuccess: context.outcome.taskSuccess,
      baselineEvidenceRecall: baselineRecall,
      contextEvidenceRecall: contextRecall,
      nonRegression: (!baseline.outcome.taskSuccess || context.outcome.taskSuccess) && contextRecall >= baselineRecall,
    },
    providerTokens: {
      ...providerView,
      baselineOutputTokens: providerTokensComparable ? baseline.usage.outputTokens : null,
      contextOutputTokens: providerTokensComparable ? context.usage.outputTokens : null,
      outputDelta: providerTokensComparable && baseline.usage.outputTokens !== null && context.usage.outputTokens !== null
        ? context.usage.outputTokens - baseline.usage.outputTokens : null,
      baselineCacheReadTokens: providerTokensComparable ? baseline.usage.cacheReadTokens : null,
      contextCacheReadTokens: providerTokensComparable ? context.usage.cacheReadTokens : null,
    },
    localTokenizer: {
      ...localView,
      tokenizer: localTokenizerComparable ? baseline.usage.tokenizer : null,
    },
    estimatedTokens: {
      ...estimatedView,
      estimator: estimatedTokensComparable ? baseline.usage.tokenizer : null,
    },
    latency: {
      comparable: measuredLatencyComparable,
      baselineWallMs: measuredLatencyComparable ? baseline.latency.wallMs : null,
      contextWallMs: measuredLatencyComparable ? context.latency.wallMs : null,
      wallDeltaMs: measuredLatencyComparable && baseline.latency.wallMs !== null && context.latency.wallMs !== null
        ? context.latency.wallMs - baseline.latency.wallMs : null,
    },
    fidelity: {
      contextCacheHotBytesChanged: context.context.cacheHotBytesChanged,
      contextCacheHotBytesChangedBasis: context.context.cacheHotBytesChangedBasis,
      measuredZeroCacheHotMutation: context.recordClass === "measured-run" && context.context.cacheHotBytesChangedBasis === "measured"
        ? context.context.cacheHotBytesChanged === 0 : null,
    },
    context: {
      packId: context.context.packId,
      selectedBytes: context.context.selectedBytes,
    },
  };
}

export function buildContextAgentEvalReport(values: unknown[]): ContextAgentEvalReport {
  assert(Array.isArray(values) && values.length > 0 && values.length <= 4_096, "Agent eval report requires between 1 and 4096 records.");
  const records = values.map(validateContextAgentEvalRecord);
  const groups = new Map<string, { baseline?: ContextAgentEvalRecordIdentity; solveContext?: ContextAgentEvalRecordIdentity }>();
  const seenHashes = new Set<string>();

  for (const record of records) {
    assert(!seenHashes.has(record.recordSha256), `Duplicate agent eval record ${record.recordSha256}.`);
    seenHashes.add(record.recordSha256);
    const key = `${record.suiteId}\0${record.pairId}`;
    const group = groups.get(key) ?? {};
    if (record.variant === "baseline") {
      assert(!group.baseline, `Agent eval pair ${record.pairId} has more than one baseline record.`);
      group.baseline = record;
    } else {
      assert(!group.solveContext, `Agent eval pair ${record.pairId} has more than one Solve Context record.`);
      group.solveContext = record;
    }
    groups.set(key, group);
  }

  const pairs = [...groups.entries()].map(([key, group]) => {
    assert(group.baseline && group.solveContext, `Agent eval pair ${key.replace("\0", ":")} is incomplete.`);
    return pairReport(group.baseline, group.solveContext);
  }).sort((left, right) => left.suiteId.localeCompare(right.suiteId) || left.pairId.localeCompare(right.pairId));

  const measuredPairs = pairs.filter((pair) => pair.measuredPair);
  const qualityRegressionPairs = measuredPairs.filter((pair) => !pair.quality.nonRegression).map((pair) => `${pair.suiteId}:${pair.pairId}`);
  const providerTokenPairs = measuredPairs.filter((pair) => pair.providerTokens.comparable);
  const latencyPairs = measuredPairs.filter((pair) => pair.latency.comparable);
  const measuredZeroCacheHotMutationPairCount = measuredPairs.filter((pair) => pair.fidelity.measuredZeroCacheHotMutation === true).length;

  const sumMetric = (items: ContextAgentEvalPairReport[], select: (pair: ContextAgentEvalPairReport) => number | null): number | null => {
    if (items.length === 0) return null;
    return items.reduce((sum, item) => sum + (select(item) ?? 0), 0);
  };
  const measuredBaselineInputTokens = sumMetric(providerTokenPairs, (pair) => pair.providerTokens.baselineInputTokens);
  const measuredContextInputTokens = sumMetric(providerTokenPairs, (pair) => pair.providerTokens.contextInputTokens);
  const meanBaselineWallMs = latencyPairs.length === 0 ? null : (sumMetric(latencyPairs, (pair) => pair.latency.baselineWallMs) ?? 0) / latencyPairs.length;
  const meanContextWallMs = latencyPairs.length === 0 ? null : (sumMetric(latencyPairs, (pair) => pair.latency.contextWallMs) ?? 0) / latencyPairs.length;

  const categories = CONTEXT_AGENT_EVAL_CATEGORIES.map((category) => ({
    category,
    measuredPairs: measuredPairs.filter((pair) => pair.fixture.category === category).length,
  }));
  const missingCategories = categories.filter(({ measuredPairs: count }) => count === 0).map(({ category }) => category);
  const agents: ContextAgentEvalAgent[] = ["claude", "codex"];
  const agentCoverage = agents.map((agent) => ({ agent, measuredPairs: measuredPairs.filter((pair) => pair.agent === agent).length }));
  const qualityGatePassed = measuredPairs.length === 0 ? null : qualityRegressionPairs.length === 0;
  const benchmarkEvidenceComplete = measuredPairs.length > 0
    && missingCategories.length === 0
    && agentCoverage.every(({ measuredPairs: count }) => count > 0)
    && qualityGatePassed === true
    && providerTokenPairs.length === measuredPairs.length
    && latencyPairs.length === measuredPairs.length;

  const canonicalIdentity = pairs.map((pair) => ({
    suiteId: pair.suiteId,
    pairId: pair.pairId,
    baselineRecordSha256: pair.baselineRecordSha256,
    contextRecordSha256: pair.contextRecordSha256,
  }));

  return {
    schema: CONTEXT_AGENT_EVAL_REPORT_SCHEMA,
    reportId: `scar_${sha256Text(JSON.stringify(canonicalIdentity)).slice(0, 32)}`,
    truth: {
      providerRequestsPerformedByHarness: 0,
      credentialsUsedByHarness: false,
      syntheticRecordsExcludedFromMeasuredAggregates: true,
      estimatedTokensAreNotProviderTokens: true,
      localTokenizerCountsAreNotProviderTokens: true,
      publicationAuthorized: false,
      publicPercentageClaimAllowed: false,
    },
    coverage: {
      categories,
      missingCategories,
      acceptanceCategoryCoverageComplete: missingCategories.length === 0,
      agents: agentCoverage,
    },
    aggregate: {
      pairCount: pairs.length,
      measuredPairCount: measuredPairs.length,
      syntheticPairCount: pairs.length - measuredPairs.length,
      qualityGatePassed,
      qualityRegressionPairs,
      providerTokenPairCount: providerTokenPairs.length,
      measuredBaselineInputTokens,
      measuredContextInputTokens,
      measuredInputTokenDelta: measuredBaselineInputTokens !== null && measuredContextInputTokens !== null
        ? measuredContextInputTokens - measuredBaselineInputTokens : null,
      measuredInputTokenDeltaPercent: measuredBaselineInputTokens !== null && measuredContextInputTokens !== null
        ? deltaPercent(measuredBaselineInputTokens, measuredContextInputTokens) : null,
      measuredLatencyPairCount: latencyPairs.length,
      meanBaselineWallMs,
      meanContextWallMs,
      meanWallDeltaMs: meanBaselineWallMs !== null && meanContextWallMs !== null ? meanContextWallMs - meanBaselineWallMs : null,
      measuredZeroCacheHotMutationPairCount,
      benchmarkEvidenceComplete,
    },
    pairs,
  };
}
