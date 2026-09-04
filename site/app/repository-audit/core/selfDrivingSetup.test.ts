import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryInventory, type RepositoryInventoryAnalysis, type RepositorySnapshot } from "./inventory";
import { createSelfDrivingSetupPlan } from "./selfDrivingSetup";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "setup-fixture.zip",
      revision: "fixture-revision",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    files,
  };
}

function textFile(path: string, text: string) {
  return { path, text, byteSize: text.length };
}

async function nextInventory(): Promise<RepositoryInventoryAnalysis> {
  return analyzeRepositoryInventory(snapshot([
    textFile("package.json", JSON.stringify({ dependencies: { next: "^16.2.7", react: "^19.2.4" } })),
    textFile("app/page.tsx", "export default function Page() { return <main>Hello</main>; }"),
    textFile(".github/workflows/ci.yml", "name: CI\non: push\njobs: {}\n"),
  ]));
}

test("Setup Agent derives a deterministic plan from Next.js/React repository evidence", async () => {
  const inventory = await nextInventory();
  const first = createSelfDrivingSetupPlan(inventory);
  const second = createSelfDrivingSetupPlan(inventory);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.self-driving.setup-plan.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.source.fingerprint, inventory.source.fingerprint);
  assert.deepEqual(first.detected.frameworks.map((item) => item.name), ["Next.js", "React"]);
  assert.ok(first.detected.deploymentTargets.some((item) => item.name === "GitHub Actions"));
  assert.equal(first.policy.requestedMode, "observe");
  assert.equal(first.policy.effectiveMode, "observe");
  assert.equal(first.policy.planOnly, true);
  assert.equal(first.policy.repositoryWriteAccess, false);
  assert.equal(first.policy.productionMutationAccess, false);
  assert.equal(first.policy.externalSideEffects, false);
  assert.equal(first.policy.emitsCommands, false);
  assert.equal(first.policy.handlesCredentials, false);
  assert.equal(first.steps[0].status, "available-now");
  assert.equal(first.steps[0].kind, "review-repository-evidence");
  assert.ok(first.steps.some((step) => step.adapter === "runtime-events" && step.scouts.includes("experience")));
  assert.ok(first.steps.some((step) => step.adapter === "error-traces" && step.scouts.includes("incident")));
  assert.ok(first.steps.some((step) => step.adapter === "deployment-health" && step.scouts.includes("rollout")));
  assert.ok(first.steps.every((step) => /^setup_[a-f0-9]{16}$/.test(step.id)));
});

test("Setup Agent maps Laravel and Django to planned server-side context without connecting it", async () => {
  const inventory = await analyzeRepositoryInventory(snapshot([
    textFile("composer.json", JSON.stringify({ require: { "laravel/framework": "^12.0" } })),
    textFile("manage.py", "from django.core.management import execute_from_command_line\n"),
    textFile("settings.py", "import django\n"),
  ]));
  const plan = createSelfDrivingSetupPlan(inventory);

  assert.deepEqual(plan.detected.frameworks.map((item) => item.name), ["Django", "Laravel"]);
  assert.ok(plan.steps.some((step) => step.adapter === "logs" && step.status === "planned"));
  assert.ok(plan.steps.some((step) => step.adapter === "error-traces" && step.status === "planned"));
  assert.ok(plan.steps.filter((step) => step.status === "planned").every((step) => step.kind === "review-context-adapter"));
  assert.equal(plan.policy.externalSideEffects, false);
});

test("unknown detected frameworks receive a generic runtime-signal review plan", async () => {
  const inventory = await nextInventory();
  inventory.inventory.frameworks = [{
    name: "CustomFramework",
    confidence: { level: "medium", score: 0.7, basis: "Bounded fixture evidence." },
    evidence: [{ path: "custom.config", kind: "config" }],
  }];

  const plan = createSelfDrivingSetupPlan(inventory);
  const generic = plan.steps.find((step) => step.adapter === "generic-runtime-signals");
  assert.ok(generic);
  assert.equal(generic?.status, "planned");
  assert.deepEqual(generic?.scouts, ["incident"]);
});

test("Setup Agent fails closed for every non-observe mode", async () => {
  const inventory = await nextInventory();
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => createSelfDrivingSetupPlan(inventory, { requestedMode }),
      /Planning is observe-only/,
    );
  }
});

test("Setup Agent rejects inventory that is not analyze-only", async () => {
  const inventory = await nextInventory();
  const unsafe = { ...inventory, mode: "write" } as unknown as RepositoryInventoryAnalysis;
  assert.throws(
    () => createSelfDrivingSetupPlan(unsafe),
    /analyze-only Repository Audit inventory only/,
  );
});

test("Setup Agent bounds detections and steps deterministically", async () => {
  const inventory = await nextInventory();
  inventory.inventory.frameworks = [
    ...inventory.inventory.frameworks,
    {
      name: "Vue",
      version: "^3.0.0",
      confidence: { level: "high", score: 0.99, basis: "Fixture." },
      evidence: [{ path: "package.json", kind: "manifest" }],
    },
  ];

  const plan = createSelfDrivingSetupPlan(inventory, { maxDetectionsPerGroup: 1, maxSteps: 2 });
  assert.equal(plan.execution.status, "partial");
  assert.equal(plan.execution.truncated, true);
  assert.ok(plan.execution.truncationReasons.includes("framework-count"));
  assert.ok(plan.execution.truncationReasons.includes("step-count"));
  assert.equal(plan.detected.frameworks.length, 1);
  assert.equal(plan.steps.length, 2);
});

test("Setup Agent output contains no executable setup commands or credentials", async () => {
  const plan = createSelfDrivingSetupPlan(await nextInventory());
  const serialized = JSON.stringify(plan).toLowerCase();

  assert.doesNotMatch(serialized, /npm install|pnpm add|yarn add|curl |wget |bash |powershell|api[_ -]?key|secret=/);
  assert.equal(plan.policy.emitsCommands, false);
  assert.equal(plan.policy.handlesCredentials, false);
});
