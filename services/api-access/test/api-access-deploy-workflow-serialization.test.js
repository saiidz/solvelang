import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  PRODUCTION_WORKFLOW_PATHS,
  findEarlierActiveProductionRunAttempts,
  waitForProductionDeploymentTurn,
} from "../scripts/wait-for-production-deployment-turn.mjs";

const workflowsDirectory = new URL("../../../.github/workflows/", import.meta.url);
const testWorkflowName = "deploy-api-access.yml";
const productionWorkflowNames = [
  "deploy-api-access-production-admin-crm.yml",
  "deploy-api-access-production-customer-accounts.yml",
  "deploy-api-access-production-foundation.yml",
  "deploy-api-access-production-totp-kms.yml",
  "deploy-api-access-production-totp.yml",
];

async function workflow(name) {
  return await readFile(new URL(name, workflowsDirectory), "utf8");
}

function productionRun({ id, attempt = 1, startedAt, status = "in_progress", path = PRODUCTION_WORKFLOW_PATHS[0] }) {
  return {
    id,
    run_attempt: attempt,
    run_started_at: startedAt,
    status,
    path,
  };
}

test("test deployment is isolated while every production mutation uses the repository queue", async () => {
  assert.deepEqual(
    [...PRODUCTION_WORKFLOW_PATHS].sort(),
    productionWorkflowNames.map((name) => `.github/workflows/${name}`).sort(),
  );

  const workflowNames = (await readdir(workflowsDirectory)).filter((name) => /\.ya?ml$/.test(name));
  const deploymentWorkflowNames = [];

  for (const name of workflowNames) {
    const source = await workflow(name);
    if (
      (/API_ACCESS_STACK_NAME/.test(source) && /sam deploy/.test(source))
      || (/solvelang-api-access-production-totp-kms/.test(source) && /cloudformation deploy/.test(source))
    ) deploymentWorkflowNames.push(name);
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
      < customerAccountsSource.indexOf("Verify production stack and capture exact feature state"),
  );

  const adminCrmSource = await workflow("deploy-api-access-production-admin-crm.yml");
  assert.ok(
    adminCrmSource.indexOf("Wait for earlier production deployment requests")
      < adminCrmSource.indexOf("Capture exact production feature state"),
  );

  const foundationSource = await workflow("deploy-api-access-production-foundation.yml");
  assert.ok(
    foundationSource.indexOf("Wait for earlier production deployment requests")
      < foundationSource.indexOf("Refuse to overwrite an enabled production stack"),
  );

  const kmsSource = await workflow("deploy-api-access-production-totp-kms.yml");
  assert.ok(
    kmsSource.indexOf("Wait for earlier production deployment requests")
      < kmsSource.indexOf("Verify live customer baseline and TOTP remains disabled"),
  );
});

test("three rapid production requests retain FIFO predecessors without dropping the middle request", () => {
  const runs = [
    productionRun({ id: 7001, startedAt: "2026-08-12T22:00:01Z" }),
    productionRun({ id: 7002, startedAt: "2026-08-12T22:00:02Z", status: "queued", path: PRODUCTION_WORKFLOW_PATHS[2] }),
    productionRun({ id: 7003, startedAt: "2026-08-12T22:00:03Z", path: PRODUCTION_WORKFLOW_PATHS[3] }),
    productionRun({ id: 7000, startedAt: "2026-08-12T22:00:00Z", path: ".github/workflows/deploy-api-access.yml" }),
  ];

  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7001, 1), []);
  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7002, 1), [
    { runId: 7001, runAttempt: 1, runStartedAt: "2026-08-12T22:00:01Z" },
  ]);
  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7003, 1), [
    { runId: 7001, runAttempt: 1, runStartedAt: "2026-08-12T22:00:01Z" },
    { runId: 7002, runAttempt: 1, runStartedAt: "2026-08-12T22:00:02Z" },
  ]);
});

test("an old run ID rerun waits for a newer run that started first", () => {
  const runs = [
    productionRun({ id: 7101, attempt: 2, startedAt: "2026-08-12T22:10:02Z", path: PRODUCTION_WORKFLOW_PATHS[3] }),
    productionRun({ id: 7102, startedAt: "2026-08-12T22:10:01Z", path: PRODUCTION_WORKFLOW_PATHS[2] }),
  ];

  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7101, 2), [
    { runId: 7102, runAttempt: 1, runStartedAt: "2026-08-12T22:10:01Z" },
  ]);
  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7102, 1), []);
});

test("a fresh deployment waits for an earlier rerun attempt", () => {
  const runs = [
    productionRun({ id: 7201, attempt: 2, startedAt: "2026-08-12T22:20:01Z", path: PRODUCTION_WORKFLOW_PATHS[2] }),
    productionRun({ id: 7203, startedAt: "2026-08-12T22:20:02Z", path: PRODUCTION_WORKFLOW_PATHS[3] }),
  ];

  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7203, 1), [
    { runId: 7201, runAttempt: 2, runStartedAt: "2026-08-12T22:20:01Z" },
  ]);
});

test("equal start timestamps use deterministic attempt-aware ordering without cycles", () => {
  const startedAt = "2026-08-12T22:30:00Z";
  const runs = [
    productionRun({ id: 7301, attempt: 2, startedAt, path: PRODUCTION_WORKFLOW_PATHS[3] }),
    productionRun({ id: 7302, startedAt, path: PRODUCTION_WORKFLOW_PATHS[1] }),
    productionRun({ id: 7303, startedAt, path: PRODUCTION_WORKFLOW_PATHS[2] }),
  ];

  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7302, 1), []);
  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7303, 1), [
    { runId: 7302, runAttempt: 1, runStartedAt: startedAt },
  ]);
  assert.deepEqual(findEarlierActiveProductionRunAttempts(runs, 7301, 2), [
    { runId: 7302, runAttempt: 1, runStartedAt: startedAt },
    { runId: 7303, runAttempt: 1, runStartedAt: startedAt },
  ]);
});

test("invalid or missing attempt metadata fails closed", () => {
  const valid = productionRun({ id: 7401, startedAt: "2026-08-12T22:40:01Z" });

  assert.throws(
    () => findEarlierActiveProductionRunAttempts([{ ...valid, run_attempt: undefined }], 7401, 1),
    /Workflow run attempt must be a positive safe integer/,
  );
  assert.throws(
    () => findEarlierActiveProductionRunAttempts([{ ...valid, run_started_at: "not-a-timestamp" }], 7401, 1),
    /Workflow run start time must be a valid timestamp/,
  );
  assert.throws(
    () => findEarlierActiveProductionRunAttempts([valid], 7401, 2),
    /Current production deployment attempt was not present/,
  );
});

test("a later production run keeps waiting after the first run finishes until the middle run finishes", async () => {
  const snapshots = [
    [
      productionRun({ id: 8001, startedAt: "2026-08-12T23:00:01Z", path: PRODUCTION_WORKFLOW_PATHS[1] }),
      productionRun({ id: 8002, startedAt: "2026-08-12T23:00:02Z", status: "queued", path: PRODUCTION_WORKFLOW_PATHS[2] }),
      productionRun({ id: 8003, startedAt: "2026-08-12T23:00:03Z", path: PRODUCTION_WORKFLOW_PATHS[3] }),
    ],
    [
      productionRun({ id: 8002, startedAt: "2026-08-12T23:00:02Z", path: PRODUCTION_WORKFLOW_PATHS[2] }),
      productionRun({ id: 8003, startedAt: "2026-08-12T23:00:03Z", path: PRODUCTION_WORKFLOW_PATHS[3] }),
    ],
    [productionRun({ id: 8003, startedAt: "2026-08-12T23:00:03Z", path: PRODUCTION_WORKFLOW_PATHS[3] })],
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
    currentRunAttempt: 1,
    pollMilliseconds: 0,
    fetchImpl,
    sleep: async () => {
      waits.push(snapshotIndex);
      snapshotIndex += 1;
    },
    log: (message) => messages.push(message),
  });

  assert.deepEqual(waits, [0, 1]);
  assert.match(messages[0], /8001 attempt 1, 8002 attempt 1/);
  assert.match(messages[1], /8002 attempt 1/);
  assert.doesNotMatch(messages[1], /8001 attempt 1/);
  assert.match(messages.at(-1), /run 8003 attempt 1 has the production deployment turn/);
});
