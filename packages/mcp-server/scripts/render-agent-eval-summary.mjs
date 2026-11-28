const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const REPORT_SCHEMA = "solvelang.context.agent-eval-report.v0";

async function readBoundedStdin() {
  if (process.stdin.isTTY) {
    throw new Error("Provide an agent-eval report JSON object on stdin.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error(`Agent eval report input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error("Agent eval report input is empty.");
  return Buffer.concat(chunks).toString("utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function num(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${round(value)}%`;
}

function ms(value) {
  return value === null || value === undefined ? "—" : `${round(value)} ms`;
}

function bool(value) {
  return value ? "yes" : "no";
}

export function renderAgentEvalSummary(report) {
  assert(report && typeof report === "object" && !Array.isArray(report), "Agent eval summary input must be a report object.");
  assert(report.schema === REPORT_SCHEMA, "Agent eval summary input is not an agent-eval report.");
  assert(report.truth && report.coverage && report.aggregate && Array.isArray(report.pairs), "Agent eval report is missing required sections.");

  const { truth, coverage, aggregate } = report;
  const comparablePairs = report.pairs.filter((pair) => pair.measuredPair && pair.providerTokens.comparable);
  const sumOutputs = (select) => comparablePairs.length === 0
    ? null
    : comparablePairs.reduce((total, pair) => total + (select(pair) ?? 0), 0);
  const baselineOutputTokens = sumOutputs((pair) => pair.providerTokens.baselineOutputTokens);
  const contextOutputTokens = sumOutputs((pair) => pair.providerTokens.contextOutputTokens);

  const lines = [];
  lines.push("# Solve Context agent-eval summary", "");
  lines.push(`Report: \`${report.reportId}\` · Pairs: ${aggregate.pairCount} (measured ${aggregate.measuredPairCount} · synthetic ${aggregate.syntheticPairCount})`, "");
  if (truth.publicationAuthorized === true) {
    lines.push("> Publication was authorized by a separate owner decision recorded outside this report.", "");
  } else {
    lines.push("> **Not authorized for publication.** This report is repository evidence only:");
    lines.push("> `publicationAuthorized: false` · `publicPercentageClaimAllowed: false`. The publication");
    lines.push("> rule is in `benchmarks/AGENT-EVAL-PROTOCOL.md` §4.", "");
  }

  lines.push("## Gates", "");
  lines.push("| Gate | Result |", "| --- | --- |");
  lines.push(`| Benchmark evidence complete | ${bool(aggregate.benchmarkEvidenceComplete)} |`);
  lines.push(`| Quality gate (no measured regression) | ${aggregate.qualityGatePassed === null ? "— (no measured pairs)" : bool(aggregate.qualityGatePassed)} |`);
  lines.push(`| Category coverage complete | ${bool(coverage.acceptanceCategoryCoverageComplete)} |`);
  lines.push(`| Bidirectional handoff coverage | ${bool(coverage.bidirectionalHandoffCoverageComplete)} |`);
  lines.push(`| Measured selection metrics on every measured pair | ${aggregate.measuredSelectionMetricPairCount} of ${aggregate.measuredPairCount} pairs |`);
  lines.push(`| Measured zero cache-hot mutation on every measured pair | ${aggregate.measuredZeroCacheHotMutationPairCount} of ${aggregate.measuredPairCount} pairs |`);
  lines.push("");

  lines.push("## Measured aggregates", "");
  lines.push("Provider-reported token pairs only; estimated, local-tokenizer, unavailable, and synthetic values are never promoted into these figures.", "");
  lines.push("| Metric | Baseline | Solve Context | Delta |", "| --- | --- | --- | --- |");
  lines.push(`| Provider input tokens (total, ${aggregate.providerTokenPairCount} pairs) | ${num(aggregate.measuredBaselineInputTokens)} | ${num(aggregate.measuredContextInputTokens)} | ${num(aggregate.measuredInputTokenDelta)} (${pct(aggregate.measuredInputTokenDeltaPercent)}) |`);
  lines.push(`| Provider output tokens (total, summed over comparable pairs) | ${num(baselineOutputTokens)} | ${num(contextOutputTokens)} | ${baselineOutputTokens === null || contextOutputTokens === null ? "—" : num(contextOutputTokens - baselineOutputTokens)} |`);
  lines.push(`| Mean wall latency (${aggregate.measuredLatencyPairCount} pairs) | ${ms(aggregate.meanBaselineWallMs)} | ${ms(aggregate.meanContextWallMs)} | ${ms(aggregate.meanWallDeltaMs)} |`);
  lines.push("");

  lines.push("## Task success", "");
  const measuredPairs = report.pairs.filter((pair) => pair.measuredPair);
  if (measuredPairs.length === 0) {
    lines.push("No measured pairs in this report; task success is counted over measured pairs only, so there are no pass counts to report here.");
  } else {
    lines.push("Measured pairs only; synthetic pairs are excluded from these counts.", "");
    lines.push("| Agent | Baseline pass | Solve Context pass |", "| --- | --- | --- |");
    const agents = [...new Set(measuredPairs.map((pair) => pair.agent))].sort();
    const passCounts = (pairs) => ({
      baseline: pairs.filter((pair) => pair.quality.baselineTaskSuccess).length,
      context: pairs.filter((pair) => pair.quality.contextTaskSuccess).length,
      total: pairs.length,
    });
    for (const agent of agents) {
      const counts = passCounts(measuredPairs.filter((pair) => pair.agent === agent));
      lines.push(`| ${agent} | ${counts.baseline} of ${counts.total} | ${counts.context} of ${counts.total} |`);
    }
    const totals = passCounts(measuredPairs);
    lines.push(`| all agents | ${totals.baseline} of ${totals.total} | ${totals.context} of ${totals.total} |`);
  }
  lines.push("");
  lines.push("## Coverage", "");
  lines.push("| Category | Measured pairs |", "| --- | --- |");
  for (const entry of coverage.categories) lines.push(`| ${entry.category} | ${entry.measuredPairs} |`);
  lines.push("", "| Agent | Measured pairs |", "| --- | --- |");
  for (const entry of coverage.agents) lines.push(`| ${entry.agent} | ${entry.measuredPairs} |`);
  lines.push("", "| Handoff direction | Measured pairs |", "| --- | --- |");
  for (const entry of coverage.handoffDirections) lines.push(`| ${entry.direction} | ${entry.measuredPairs} |`);
  lines.push("");

  lines.push("## Quality regressions", "");
  if (aggregate.qualityRegressionPairs.length === 0) {
    lines.push("None recorded among measured pairs.");
  } else {
    for (const pair of aggregate.qualityRegressionPairs) lines.push(`- ${pair}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Agent eval summary renderer accepts no file, URL, or credential arguments.");
  }
  const input = JSON.parse(await readBoundedStdin());
  process.stdout.write(renderAgentEvalSummary(input));
}

if (process.argv[1]?.endsWith("render-agent-eval-summary.mjs")) {
  main().catch((error) => {
    process.stderr.write(`context-agent-eval-summary: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
