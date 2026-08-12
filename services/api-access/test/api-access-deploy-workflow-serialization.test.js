import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  PRODUCTION_WORKFLOW_PATHS,
  findEarlierActiveProductionRunIds,
  waitForProductionDeploymentTurn,
} from "../scripts/wait-for-production-deployment-turn.mjs";

const workflowsDirectory = new URL("../../../.github/workflows/", import.meta.url);
const testWorkflowName = "deploy-api-access.yml";
const productionWorkflowNames = [
  "deploy-api-access-production-customer-accounts.yml",
  "deploy-api-access-production-foundation.yml",
];

async function workflow(name) {
  return await readFile(new URL(name, workflowsDirectory), "utf8");
}

test("test deployment is isolated while both production deployments use the repository queue", async () => {
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) => /\.ya?ml$/.test(name));
  const deploymentWorkflowNames = [];

  for (const name of workflowNames) {
    const source = await workflow(name);
    if (/API_ACCESS_STACK_NAME/.test(source) && /sam deploy/.test(source)) deploymentWorkflowNames.push(name);
  }

  assert.deepEqual(deploymentWorkflowNames.sort(), [...productionWorkflowNames, testWorkflowName].sort());

  const testSource = await workflow(testWorkflowName);
  assert.match(testSource, /concurrency:\n  group: api-access-test-deployment\n  cancel-in-progress: false/);
  assert.doesNotMatch(testSource, /wait-for-production-deployment-turn/);

  for (const name of productionWorkflowNames) {
    const source = await workflow(name);
    assert.doesNotMatch(source, /^concurrency:/m, name);
    assert.match(source, /actions: read/, name);
    assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/, name);
  }

  const customerAccountsSource = await workflow("deploy-api-access-production-customer-accounts.yml");
  assert.ok(
    customerAccountsSource.indexOf("Wait for earlier production deployment requests")
      < customerAccountsSource.indexOf("Verify production stack is safe to enable"),
  );

  const foundationSource = await workflow("deploy-api-access-production-foundation.yml");
  assert.ok(
    foundationSource.indexOf("Wait for earlier production deployment requests")
      < foundationSource.indexOf("Refuse to overwrite an enabled production stack"),
  );
});

test("three rapid production requests retain FIFO predecessors without dropping the middle request", () => {
  const runs = [
    { id: 7001, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] },
    { id: 7002, status: "queued", path: PRODUCTION_WORKFLOW_PATHS[1] },
    { id: 7003, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] },
    { id: 7000, status: "in_progress", path: ".github/workflows/deploy-api-access.yml" },
  ];

  assert.deepEqual(findEarlierActiveProductionRunIds(runs, 7001), []);
  assert.deepEqual(findEarlierActiveProductionRunIds(runs, 7002), [7001]);
  assert.deepEqual(findEarlierActiveProductionRunIds(runs, 7003), [7001, 7002]);
});

test("a later production run keeps waiting after the first run finishes until the middle run finishes", async () => {
  const snapshots = [
    [
      { id: 8001, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] },
      { id: 8002, status: "queued", path: PRODUCTION_WORKFLOW_PATHS[1] },
      { id: 8003, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] },
    ],
    [
      { id: 8002, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[1] },
      { id: 8003, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] },
    ],
    [{ id: 8003, status: "in_progress", path: PRODUCTION_WORKFLOW_PATHS[0] }],
  ];
  let snapshotIndex = 0;
  const waits = [];
  const messages = [];
  const fetchImpl = async (url) => {
    const status = new URL(url).searchParams.get("status");
    return {
      ok: true,
      status: 200,
      async json() {
        return { workflow_runs: snapshots[snapshotIndex].filter((run) => run.status === status) };
      },
    };
  };

  await waitForProductionDeploymentTurn({
    apiUrl: "https://api.github.example",
    repository: "saiidz/solvelang",
    token: "test-token",
    currentRunId: 8003,
    pollMilliseconds: 0,
    fetchImpl,
    sleep: async () => {
      waits.push(snapshotIndex);
      snapshotIndex += 1;
    },
    log: (message) => messages.push(message),
  });

  assert.deepEqual(waits, [0, 1]);
  assert.match(messages[0], /8001, 8002/);
  assert.match(messages[1], /8002/);
  assert.doesNotMatch(messages[1], /8001/);
  assert.match(messages.at(-1), /run 8003 has the production deployment turn/);
});
