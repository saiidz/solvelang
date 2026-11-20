// Phase 6 real-agent validation: the spike's workload shape
// (producer/reviewer, two contention events, one injected block)
// run by two REAL agent processes speaking the real bus protocol
// against the PRODUCT daemon started through the shipped CLI in
// registry mode. The bar is the spike's conflicts leg: zero late
// conflicts, claim-time conflicts absorbing the contention, and a
// final repository state that is exactly correct.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  assertFinalState,
  busCliPath,
  execFileAsync,
  readResult,
  runAgent,
  setupWorkspace,
} from "./bus-validation-helpers.js";

test("bus validation: product bus absorbs contention with zero late conflicts", { timeout: 150_000 }, async () => {
  const workspace = setupWorkspace();
  const keysDir = path.join(workspace, "keys");
  await execFileAsync(process.execPath, [
    busCliPath, "start", "--workspace", workspace, "--keys", path.join(keysDir, "registry.json"),
  ]);
  const startedAt = Date.now();
  try {
    await Promise.all([runAgent(workspace, "producer"), runAgent(workspace, "reviewer")]);
  } finally {
    await execFileAsync(process.execPath, [busCliPath, "stop", "--workspace", workspace]).catch(() => undefined);
  }
  const wallMs = Date.now() - startedAt;
  const producer = readResult(workspace, "producer");
  const reviewer = readResult(workspace, "reviewer");
  assert.equal(producer.error, undefined);
  assert.equal(reviewer.error, undefined);
  assert.equal(producer.fallbackUsed, false, "producer stayed on the bus");
  assert.equal(reviewer.fallbackUsed, false, "reviewer stayed on the bus");
  assert.equal(
    producer.metrics.lateConflicts + reviewer.metrics.lateConflicts,
    0,
    "the spike's bar: zero late conflicts on the bus",
  );
  assert.ok(
    producer.metrics.claimTimeConflicts + reviewer.metrics.claimTimeConflicts >= 2,
    "contention was absorbed as claim-time conflicts",
  );
  assertFinalState(workspace);
  console.log(`bus validation wall clock: ${wallMs}ms (spike bus arm median 6,616ms local / 6,649ms EC2)`);
});

test("bus validation harness: the shipped CLI runs the daemon in the foreground", { timeout: 30_000 }, async () => {
  // Pins the exact process shape the kill-switch test drives.
  const workspace = setupWorkspace();
  const keysDir = path.join(workspace, "keys");
  const child = spawn(
    process.execPath,
    [busCliPath, "start", "--foreground", "--workspace", workspace, "--keys", path.join(keysDir, "registry.json")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const ready = await new Promise<{ port: number; auth: string }>((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const match = /BUS_READY (\d+) auth=(\S+)/.exec(buffer);
        if (match) resolve({ port: Number(match[1]), auth: match[2] });
      });
      child.once("error", reject);
      setTimeout(() => reject(new Error("foreground daemon did not report BUS_READY")), 10_000);
    });
    assert.equal(ready.auth, "registry");
    assert.ok(ready.port > 0);
  } finally {
    child.kill("SIGKILL");
  }
});
