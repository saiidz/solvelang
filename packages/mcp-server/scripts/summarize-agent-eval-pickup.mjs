import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildContextAgentEvalReport, validateContextAgentEvalRecord } from "../dist/src/context-agent-eval.js";
import { renderAgentEvalSummary } from "./render-agent-eval-summary.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function headlineLines(report) {
  const { aggregate } = report;
  const lines = [];
  lines.push(`Pairs: ${aggregate.pairCount} (measured ${aggregate.measuredPairCount} · synthetic ${aggregate.syntheticPairCount})`);
  const measuredPairs = report.pairs.filter((pair) => pair.measuredPair);
  if (measuredPairs.length === 0) {
    lines.push("Task success (measured pairs only): no measured pairs");
  } else {
    lines.push("Task success (measured pairs only):");
    const agents = [...new Set(measuredPairs.map((pair) => pair.agent))].sort();
    for (const agent of agents) {
      const agentPairs = measuredPairs.filter((pair) => pair.agent === agent);
      const baselinePass = agentPairs.filter((pair) => pair.quality.baselineTaskSuccess).length;
      const contextPass = agentPairs.filter((pair) => pair.quality.contextTaskSuccess).length;
      lines.push(`- ${agent}: baseline ${baselinePass} of ${agentPairs.length} · Solve Context ${contextPass} of ${agentPairs.length}`);
    }
    if (agents.length > 1) {
      const baselinePass = measuredPairs.filter((pair) => pair.quality.baselineTaskSuccess).length;
      const contextPass = measuredPairs.filter((pair) => pair.quality.contextTaskSuccess).length;
      lines.push(`- all agents: baseline ${baselinePass} of ${measuredPairs.length} · Solve Context ${contextPass} of ${measuredPairs.length}`);
    }
  }
  const delta = aggregate.measuredInputTokenDeltaPercent;
  lines.push(`Provider input-token delta: ${delta === null || delta === undefined ? "— (no comparable provider-reported pairs)" : `${round(delta)}%`}`);
  return lines;
}

export async function summarizeAgentEvalPickup(recordsFile, outputDir) {
  const raw = await readFile(recordsFile);
  if (raw.length > MAX_INPUT_BYTES) throw new Error(`Agent eval pickup input exceeds ${MAX_INPUT_BYTES} bytes.`);
  if (raw.length === 0) throw new Error("Agent eval pickup input is empty.");
  const input = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(input)) throw new Error("Agent eval pickup input must be a JSON array of agent-eval records.");
  input.forEach((value, index) => {
    try {
      validateContextAgentEvalRecord(value);
    } catch (error) {
      throw new Error(`Agent eval record at index ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const report = buildContextAgentEvalReport(input);
  const summary = renderAgentEvalSummary(report);
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "agent-eval-report.json");
  const summaryPath = path.join(outputDir, "agent-eval-summary.md");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, summary, "utf8");
  return { report, reportPath, summaryPath };
}

async function main() {
  if (process.argv.length !== 4) {
    throw new Error("Usage: node scripts/summarize-agent-eval-pickup.mjs <records-file> <output-dir>");
  }
  const [recordsFile, outputDir] = process.argv.slice(2);
  const { report, reportPath, summaryPath } = await summarizeAgentEvalPickup(recordsFile, outputDir);
  process.stdout.write(`agent-eval-report: ${reportPath}\n`);
  process.stdout.write(`agent-eval-summary: ${summaryPath}\n`);
  for (const line of headlineLines(report)) process.stdout.write(`${line}\n`);
}

if (process.argv[1]?.endsWith("summarize-agent-eval-pickup.mjs")) {
  main().catch((error) => {
    process.stderr.write(`context-agent-eval-pickup: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
