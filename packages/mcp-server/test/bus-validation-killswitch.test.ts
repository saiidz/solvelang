// Phase 6 kill-switch validation on product code: the daemon is
// SIGKILLed mid-run and the two agent processes must still finish
// the workload correctly on handoff documents alone — no state
// loss, no duplicate or missing edits. (Late conflicts are allowed
// here; correctness is the bar, exactly as in the spike's
// kill-switch run.)
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  assertFinalState,
  busCliPath,
  readResult,
  runAgent,
  setupWorkspace,
} from "./bus-validation-helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForStateLine(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("BUS_READY")) resolve();
    });
    child.once("error", reject);
    setTimeout(() => reject(new Error("foreground daemon did not report BUS_READY")), 10_000);
  });
}

test("bus validation: daemon killed mid-run, agents finish on documents with no state loss", { timeout: 150_000 }, async () => {
  const workspace = setupWorkspace();
  const keysDir = path.join(workspace, "keys");
  const daemon = spawn(
    process.execPath,
    [busCliPath, "start", "--foreground", "--workspace", workspace, "--keys", path.join(keysDir, "registry.json")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitForStateLine(daemon);
  const startedAt = Date.now();
  const agents = Promise.all([runAgent(workspace, "producer"), runAgent(workspace, "reviewer")]);
  await sleep(1_200);
  daemon.kill("SIGKILL");
  await agents;
  const wallMs = Date.now() - startedAt;
  const producer = readResult(workspace, "producer");
  const reviewer = readResult(workspace, "reviewer");
  assert.equal(producer.error, undefined);
  assert.equal(reviewer.error, undefined);
  assert.ok(
    producer.fallbackUsed === true || reviewer.fallbackUsed === true,
    "at least one agent fell back to documents after the kill",
  );
  assertFinalState(workspace);
  console.log(
    `kill-switch validation wall clock: ${wallMs}ms, late conflicts: ` +
      `${producer.metrics.lateConflicts + reviewer.metrics.lateConflicts} ` +
      `(spike kill-switch run: 7,828ms local / 7,988ms EC2, 1 late conflict)`,
  );
});
