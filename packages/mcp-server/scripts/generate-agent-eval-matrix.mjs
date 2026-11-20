import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../dist/src/context-pack.js";

const AGENTS = ["claude", "codex"];
const CATEGORIES = [
  "monorepo-bug-fix",
  "github-issue-triage",
  "ci-log-diagnosis",
  "multi-file-refactor",
  "json-heavy-tool-output",
  "cross-agent-handoff",
];
const HANDOFF_DIRECTIONS = ["claude-to-codex", "codex-to-claude"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export const fixtureRevisionSha256 = (suiteCase) => sha256Text(JSON.stringify(canonical(suiteCase)));

export function evidenceRequiredCount(suiteCase) {
  assert(suiteCase?.requiredEvidence && typeof suiteCase.requiredEvidence === "object", "Suite case has no requiredEvidence map.");
  return Object.values(suiteCase.requiredEvidence).reduce((total, needles) => {
    assert(Array.isArray(needles), "Suite case requiredEvidence entries must be arrays.");
    return total + needles.length;
  }, 0);
}

function validateRegistry(registry) {
  assert(registry && typeof registry === "object" && !Array.isArray(registry), "Fixture registry must be an object.");
  assert(registry.schema === "solvelang.context.agent-eval-fixtures.v1", "Unsupported fixture registry schema.");
  assert(typeof registry.suiteId === "string" && registry.suiteId.length > 0, "Fixture registry suiteId is required.");
  assert(Number.isSafeInteger(registry.repsPerCell) && registry.repsPerCell >= 1 && registry.repsPerCell <= 10, "Fixture registry repsPerCell must be between 1 and 10.");
  assert(registry.outcomeBasis === "human-reviewed" || registry.outcomeBasis === "deterministic-check", "Fixture registry outcomeBasis must be a measured outcome basis.");
  assert(Array.isArray(registry.fixtures) && registry.fixtures.length > 0, "Fixture registry fixtures must be a non-empty array.");
  const ids = new Set();
  for (const fixture of registry.fixtures) {
    assert(typeof fixture.fixtureId === "string" && fixture.fixtureId.length > 0 && !ids.has(fixture.fixtureId), "Fixture registry fixtureId values must be unique and non-empty.");
    ids.add(fixture.fixtureId);
    assert(CATEGORIES.includes(fixture.category), `Fixture ${fixture.fixtureId} category is not a record-contract category.`);
    if (fixture.category === "cross-agent-handoff") {
      assert(HANDOFF_DIRECTIONS.includes(fixture.handoffDirection), `Fixture ${fixture.fixtureId} requires a handoff direction.`);
    } else {
      assert(fixture.handoffDirection === null, `Fixture ${fixture.fixtureId} may not set a handoff direction.`);
    }
    assert(Array.isArray(fixture.agents) && fixture.agents.length > 0 && fixture.agents.every((agent) => AGENTS.includes(agent)), `Fixture ${fixture.fixtureId} agents must be a non-empty subset of ${AGENTS.join("/")}.`);
    assert(typeof fixture.sourceSuite === "string" && typeof fixture.sourceCaseId === "string", `Fixture ${fixture.fixtureId} must name its source suite and case.`);
    for (const agent of fixture.agents) {
      assert(typeof registry.providers?.[agent]?.name === "string", `Fixture registry has no provider name for agent ${agent}.`);
    }
  }
  return registry;
}

function recordTemplate(registry, fixture, suiteCase, agent, pairId, variant) {
  const isContext = variant === "solve_context";
  return {
    schema: "solvelang.context.agent-eval-record.v0",
    suiteId: registry.suiteId,
    pairId,
    fixture: {
      id: fixture.fixtureId,
      category: fixture.category,
      revisionSha256: fixtureRevisionSha256(suiteCase),
      handoffDirection: fixture.handoffDirection,
    },
    agent,
    variant,
    provider: { name: registry.providers[agent].name, model: "OPERATOR-RECORDED" },
    recordClass: "measured-run",
    outcome: {
      taskSuccess: null,
      basis: registry.outcomeBasis,
      evidenceRequired: evidenceRequiredCount(suiteCase),
      evidenceRetained: null,
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: { wallMs: null, basis: "measured" },
    context: isContext
      ? {
        packId: null,
        selectedBytes: null,
        cacheHotBytesChanged: null,
        cacheHotBytesChangedBasis: "measured",
        selectionPrecision: null,
        selectionRecall: null,
        selectionMetricsBasis: "measured",
      }
      : {
        packId: null,
        selectedBytes: null,
        cacheHotBytesChanged: null,
        cacheHotBytesChangedBasis: "unavailable",
        selectionPrecision: null,
        selectionRecall: null,
        selectionMetricsBasis: "unavailable",
      },
  };
}

function runLogTemplate(fixture, agent, rep, pairId, armOrder) {
  return {
    schema: "solvelang.context.agent-eval-runlog.v1",
    pairId,
    fixtureId: fixture.fixtureId,
    agent,
    rep,
    buildCommit: "OPERATOR-RECORDED",
    workspaceTreeSha256: null,
    armOrder,
    operator: null,
    reviewer: null,
    arms: {
      baseline: { startedAt: null, endedAt: null, usageSource: null },
      solve_context: {
        startedAt: null,
        endedAt: null,
        usageSource: null,
        packColdSha256: null,
        packServedSha256: null,
        scorerOutputRef: null,
      },
    },
    multiFileEditFailures: [],
    notes: "",
  };
}

function buildChecklist(registry, cells) {
  const lines = [
    `# Agent-eval run matrix — ${registry.suiteId}`,
    "",
    `Pairs: ${cells.length} · Records: ${cells.length * 2} · Repetitions per cell: ${registry.repsPerCell} · Outcome basis: ${registry.outcomeBasis}`,
    "",
    "Protocol: benchmarks/AGENT-EVAL-PROTOCOL.md. Validate each record on arrival with",
    "`npm run eval:context:agent-records:validate`; summarize the full matrix with",
    "`npm run eval:context:agent-records`. Do not coach the agent during any run.",
    "",
  ];
  let currentFixture = null;
  for (const cell of cells) {
    if (cell.fixtureId !== currentFixture) {
      currentFixture = cell.fixtureId;
      lines.push(`## ${currentFixture} (${cell.category})`, "");
    }
    const [first, second] = cell.armOrder;
    lines.push(`- [ ] ${cell.pairId} — run ${first} first, then ${second}; fresh session per arm; reset the workspace between arms`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateAgentEvalMatrix(registry, suites) {
  validateRegistry(registry);
  const cells = [];
  const recordTemplates = [];
  const runLogTemplates = [];

  for (const fixture of registry.fixtures) {
    const suite = suites[fixture.sourceSuite];
    assert(suite, `Source suite ${fixture.sourceSuite} was not loaded.`);
    const suiteCase = (suite.cases ?? []).find((entry) => entry.id === fixture.sourceCaseId);
    assert(suiteCase, `Source case ${fixture.sourceCaseId} is absent from ${fixture.sourceSuite}.`);
    for (const agent of fixture.agents) {
      for (let rep = 1; rep <= registry.repsPerCell; rep += 1) {
        const pairId = `${fixture.fixtureId}-${agent}-r${rep}`;
        const armOrder = rep % 2 === 1 ? ["baseline", "solve_context"] : ["solve_context", "baseline"];
        cells.push({
          pairId,
          fixtureId: fixture.fixtureId,
          category: fixture.category,
          handoffDirection: fixture.handoffDirection,
          agent,
          rep,
          armOrder,
          budgetBytes: suiteCase.budgetBytes,
          evidenceRequired: evidenceRequiredCount(suiteCase),
        });
        recordTemplates.push(recordTemplate(registry, fixture, suiteCase, agent, pairId, "baseline"));
        recordTemplates.push(recordTemplate(registry, fixture, suiteCase, agent, pairId, "solve_context"));
        runLogTemplates.push(runLogTemplate(fixture, agent, rep, pairId, armOrder));
      }
    }
  }

  return {
    schema: "solvelang.context.agent-eval-matrix.v1",
    suiteId: registry.suiteId,
    repsPerCell: registry.repsPerCell,
    pairCount: cells.length,
    recordCount: recordTemplates.length,
    cells,
    recordTemplates,
    runLogTemplates,
    checklist: buildChecklist(registry, cells),
  };
}

async function main() {
  assert(process.argv.length === 2, "Agent eval matrix generator accepts no file, URL, or credential arguments.");
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const registry = JSON.parse(await readFile(path.join(packageRoot, "benchmarks", "agent-eval-fixtures-v1.json"), "utf8"));
  const suites = {};
  for (const fixture of registry.fixtures ?? []) {
    if (!suites[fixture.sourceSuite]) {
      suites[fixture.sourceSuite] = JSON.parse(await readFile(path.join(packageRoot, fixture.sourceSuite), "utf8"));
    }
  }
  const matrix = generateAgentEvalMatrix(registry, suites);
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("generate-agent-eval-matrix.mjs")) {
  main().catch((error) => {
    process.stderr.write(`context-agent-eval-matrix: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
