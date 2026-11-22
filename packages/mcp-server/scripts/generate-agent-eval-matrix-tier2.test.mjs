import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../dist/src/context-pack.js";
import {
  evidenceRequiredCount,
  fixtureRevisionSha256,
  generateAgentEvalMatrix,
} from "./generate-agent-eval-matrix.mjs";
import { gitBlobSha1 } from "./run-context-repository-evals.mjs";

const script = fileURLToPath(new URL("./generate-agent-eval-matrix-tier2.mjs", import.meta.url));
const packageFile = (relative) => new URL(`../${relative}`, import.meta.url);

async function loadJson(relative) {
  return JSON.parse(await readFile(packageFile(relative), "utf8"));
}

async function loadRegistryAndSuites() {
  const registry = await loadJson("benchmarks/agent-eval-fixtures-v2-tier2.json");
  const suites = {};
  for (const fixture of registry.fixtures) {
    if (!suites[fixture.sourceSuite]) suites[fixture.sourceSuite] = await loadJson(fixture.sourceSuite);
  }
  return { registry, suites };
}

function runGenerator() {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

test("generates the full Tier 2 matrix from the checked-in registry", () => {
  const result = runGenerator();
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout);
  assert.equal(matrix.schema, "solvelang.context.agent-eval-matrix.v1");
  assert.equal(matrix.suiteId, "agent-eval-v2-tier2");
  // 15 fixtures x 2 agents x 3 repetitions; Tier 2 has no handoff fixtures.
  assert.equal(matrix.pairCount, 90);
  assert.equal(matrix.recordCount, 180);
  assert.equal(matrix.cells.length, 90);
  assert.equal(matrix.recordTemplates.length, 180);
  assert.equal(matrix.runLogTemplates.length, 90);
  assert.equal(new Set(matrix.cells.map((cell) => cell.pairId)).size, 90);
  assert.match(matrix.checklist, /preact-keyed-child-minimal-move-claude-r1/);
  assert.match(matrix.checklist, /Do not coach the agent/);
});

test("registry pins fifteen tier-2 fixtures with a written basis for every category", async () => {
  const { registry } = await loadRegistryAndSuites();
  assert.equal(registry.schema, "solvelang.context.agent-eval-fixtures.v1");
  assert.equal(registry.repsPerCell, 3);
  assert.equal(registry.outcomeBasis, "human-reviewed");
  assert.equal(registry.fixtures.length, 15);
  const categories = new Set();
  for (const fixture of registry.fixtures) {
    assert.equal(fixture.tier, 2);
    assert.equal(fixture.handoffDirection, null);
    assert.deepEqual(fixture.agents, ["claude", "codex"]);
    assert.equal(typeof fixture.categoryBasis, "string");
    assert.ok(fixture.categoryBasis.length >= 40, `${fixture.fixtureId} categoryBasis is too thin to be a written basis.`);
    categories.add(fixture.category);
  }
  // Tier 2 tasks are trace/review/diagnosis tasks: no edit task and no
  // handoff, so these two contract categories are intentionally absent.
  assert.deepEqual([...categories].sort(), ["ci-log-diagnosis", "github-issue-triage", "json-heavy-tool-output", "multi-file-refactor"]);
  const suitesUsed = new Set(registry.fixtures.map((fixture) => fixture.sourceSuite));
  assert.deepEqual(Object.keys(registry.workspaceMaterialization.snapshotDirectories).sort(), [...suitesUsed].sort());
});

test("covers every fixture, agent, and repetition with source-derived budgets and evidence", async () => {
  const { registry, suites } = await loadRegistryAndSuites();
  const matrix = generateAgentEvalMatrix(registry, suites);
  const cellByPairId = new Map(matrix.cells.map((cell) => [cell.pairId, cell]));
  for (const fixture of registry.fixtures) {
    const suiteCase = suites[fixture.sourceSuite].cases.find((entry) => entry.id === fixture.sourceCaseId);
    assert.ok(suiteCase, `${fixture.sourceCaseId} must exist in ${fixture.sourceSuite}`);
    for (const agent of fixture.agents) {
      for (let rep = 1; rep <= registry.repsPerCell; rep += 1) {
        const pairId = `${fixture.fixtureId}-${agent}-r${rep}`;
        const cell = cellByPairId.get(pairId);
        assert.ok(cell, `missing cell ${pairId}`);
        assert.equal(cell.category, fixture.category);
        assert.equal(cell.budgetBytes, suiteCase.budgetBytes);
        assert.equal(cell.evidenceRequired, evidenceRequiredCount(suiteCase));
        assert.deepEqual(cell.armOrder, rep % 2 === 1 ? ["baseline", "solve_context"] : ["solve_context", "baseline"]);
      }
    }
  }
});

test("record templates carry the revision hash computed from the source case", async () => {
  const { registry, suites } = await loadRegistryAndSuites();
  const matrix = generateAgentEvalMatrix(registry, suites);
  for (const fixture of registry.fixtures) {
    const suiteCase = suites[fixture.sourceSuite].cases.find((entry) => entry.id === fixture.sourceCaseId);
    const expected = fixtureRevisionSha256(suiteCase);
    const templates = matrix.recordTemplates.filter((template) => template.fixture.id === fixture.fixtureId);
    assert.equal(templates.length, fixture.agents.length * registry.repsPerCell * 2);
    for (const template of templates) {
      assert.equal(template.suiteId, "agent-eval-v2-tier2");
      assert.equal(template.fixture.revisionSha256, expected);
      assert.equal(template.fixture.category, fixture.category);
      assert.equal(template.outcome.evidenceRequired, evidenceRequiredCount(suiteCase));
    }
  }
});

test("a mutated source case invalidates its fixture revision and evidence count", async () => {
  const { registry, suites } = await loadRegistryAndSuites();
  const before = generateAgentEvalMatrix(registry, suites);
  const revisionOf = (matrix, fixtureId) => matrix.recordTemplates.find((template) => template.fixture.id === fixtureId).fixture.revisionSha256;
  const mutated = structuredClone(suites);
  const target = mutated["benchmarks/context-repository-v1.json"].cases.find((entry) => entry.id === "jsonld-escape-review");
  const firstPath = Object.keys(target.requiredEvidence)[0];
  target.requiredEvidence[firstPath] = [...target.requiredEvidence[firstPath], "a needle that was never pinned"];
  const after = generateAgentEvalMatrix(registry, mutated);
  assert.notEqual(revisionOf(after, "jsonld-escape-review"), revisionOf(before, "jsonld-escape-review"));
  assert.equal(revisionOf(after, "preact-keyed-child-minimal-move"), revisionOf(before, "preact-keyed-child-minimal-move"));
  const cellBefore = before.cells.find((cell) => cell.pairId === "jsonld-escape-review-claude-r1");
  const cellAfter = after.cells.find((cell) => cell.pairId === "jsonld-escape-review-claude-r1");
  assert.equal(cellAfter.evidenceRequired, cellBefore.evidenceRequired + 1);
});

test("every pinned corpus source resolves to a byte-exact snapshot", async () => {
  const { registry } = await loadRegistryAndSuites();
  for (const [sourceSuite, snapshotDirectory] of Object.entries(registry.workspaceMaterialization.snapshotDirectories)) {
    const corpus = await loadJson(sourceSuite);
    assert.ok(corpus.sources.length > 0, `${sourceSuite} must pin sources`);
    for (const source of corpus.sources) {
      const blobId = source.gitBlobSha1 ?? (source.gitBlobSha1Parts ?? []).join("");
      assert.match(blobId, /^[a-f0-9]{40}$/, `${sourceSuite} source ${source.path} has no 40-hex blob identity`);
      const text = await readFile(packageFile(`${snapshotDirectory}/${blobId}.txt`), "utf8");
      assert.equal(gitBlobSha1(text), blobId, `${source.path} snapshot bytes drifted from its pinned blob`);
      if (typeof source.sha256 === "string") {
        assert.equal(sha256Text(text), source.sha256, `${source.path} snapshot bytes drifted from its pinned sha256`);
      }
    }
  }
});
