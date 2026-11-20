// One agent half of the Phase 6 validation workload, run as its own
// process against the PRODUCT bus code (dist/src/bus-client.js +
// the solvelang-bus daemon). The workload is the Phase 6 spike's
// task graph, unchanged in shape and timings: producer + reviewer
// split a five-file change, with two barrier contention events and
// one injected block. Documents are written in every step (the
// client does that itself); the bus carries signals and claims.
//
// Contention is deterministic by construction (see sharedEdit):
// the spike ran both agents in one process and released the two
// edits at a single program point; two processes instead rendezvous
// on workspace files, and the claim holder waits for the peer's
// claim-outcome file before releasing, so the claim-time denial
// follows from message ordering, never from wall-clock overlap.
//
// Usage:
//   node scripts/bus-validation-agent.mjs --agent producer|reviewer \
//     --workspace <dir> --keys <dir with registry.json + <agent>.key.json>
//
// Writes <workspace>/result-<agent>.json and exits 0 on success.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BusClient } from "../dist/src/bus-client.js";
import { BusKeyRegistry, parsePrivateKeyText } from "../dist/src/bus-envelope.js";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}
const AGENT = args.agent;
const PEER = AGENT === "producer" ? "reviewer" : "producer";
const WORKSPACE = args.workspace;
const KEYS_DIR = args.keys;

const WORK_MS = 450; // one file edit's work (spike timing)
const RECHECK_MS = 400; // acceptance recheck paid by a late-conflict loser (spike)
const BLOCK_MS = 2_500; // injected reviewer silence (spike)
const CLAIM_TTL_MS = 8_000; // spike claim TTL

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const repoFile = (file) => path.join(WORKSPACE, "repo", file);
const appendLine = (file, line) => appendFileSync(repoFile(file), `${line}\n`);

const metrics = { lateConflicts: 0, claimTimeConflicts: 0, presenceChecks: [], firstClaims: {} };
const t0 = Date.now();

const registry = BusKeyRegistry.fromText(readFileSync(path.join(KEYS_DIR, "registry.json"), "utf8"));
const privateKey = parsePrivateKeyText(readFileSync(path.join(KEYS_DIR, `${AGENT}.key.json`), "utf8"));
const client = await BusClient.connect({
  agent: AGENT,
  workspaceDir: WORKSPACE,
  privateKey,
  registry,
});

async function soloEdit(file, line) {
  await sleep(WORK_MS);
  appendLine(file, line);
}

// Deterministic contention scaffolding. The rendezvous uses plain
// files in the workspace, NOT bus messages: synchronization must
// not itself depend on delivery timing (a bus wait only observes
// messages its client happens to be waiting for when they arrive,
// so a send-then-wait rendezvous can miss its own release). Each
// agent publishes a ready file per contention event and waits for
// the peer's, so both reach for the same item from the same release
// point; each then publishes its first claim outcome, and the
// granted holder waits for the peer's outcome file before editing
// and releasing — the peer's first claim is therefore necessarily
// processed by the daemon during the hold, and its denial is a
// happens-before consequence, not a race inside the edit window.
// (The failure mode this replaced: the second agent's claim landing
// after the holder had already released, so no denial was recorded
// and the contention assertion depended on CI load.) The files live
// outside repo/ and play no part in the workload's final state.
const syncDir = path.join(WORKSPACE, "sync");
mkdirSync(syncDir, { recursive: true });

function publishSync(name, content) {
  const temporary = path.join(syncDir, `.tmp-${name}`);
  writeFileSync(temporary, content);
  renameSync(temporary, path.join(syncDir, name));
}

async function awaitSync(name) {
  while (!existsSync(path.join(syncDir, name))) await sleep(20);
}

async function barrier(item) {
  publishSync(`${item}.${AGENT}.ready`, "ready");
  await awaitSync(`${item}.${PEER}.ready`);
}

// Shared edit, spike semantics on product primitives: through the
// daemon the claim is atomic (denial = claim-time conflict, wait for
// the release, edit once on the final base). Through documents
// (daemon down) the claim is a document the peer sees late, so the
// conflict surfaces at write time and the loser redoes the work.
async function sharedEdit(file, line, item) {
  await barrier(item);
  let firstAttempt = true;
  for (;;) {
    const res = await client.claim(item, CLAIM_TTL_MS);
    if (firstAttempt) {
      firstAttempt = false;
      metrics.firstClaims[item] = res.granted;
      publishSync(`${item}.${AGENT}.claim`, JSON.stringify({ granted: res.granted }));
    }
    if (!res.viaBus) {
      await client.send({ toAgent: PEER, kind: "claim", body: { item } });
      const before = sha(readFileSync(repoFile(file), "utf8"));
      await sleep(WORK_MS);
      const now = sha(readFileSync(repoFile(file), "utf8"));
      if (now !== before) {
        metrics.lateConflicts++;
        await sleep(WORK_MS + RECHECK_MS);
      }
      appendLine(file, line);
      await client.release(item);
      return;
    }
    if (res.granted) {
      // Hold the claim until the peer's first claim attempt has been
      // processed (its outcome file proves it) — see above.
      await awaitSync(`${item}.${PEER}.claim`);
      break;
    }
    metrics.claimTimeConflicts++;
    await Promise.race([
      client.waitForSignalKind(
        "signal",
        (body) => body?.signal === "claim_released" && body?.item === item,
      ),
      sleep(1_000),
    ]);
  }
  await sleep(WORK_MS);
  appendLine(file, line);
  await client.release(item);
}

const stepIs = (step) => (body) => body?.step === step;

async function producer() {
  await soloEdit("auth.txt", "auth: token-refresh");
  await client.sendSignal("reviewer", { step: "A1" });
  await client.waitForSignalKind("signal", stepIs("B1"));
  await sharedEdit("shared-config.txt", "config: timeout=30", "shared-config");
  await soloEdit("api.txt", "api: rate-limit");
  await client.sendSignal("reviewer", { step: "A3" });
  await sharedEdit("changelog.txt", "change: api rate-limit", "changelog");
  await sleep(600); // mid-block presence check, as in the spike
  const presence = await client.presence("reviewer");
  metrics.presenceChecks.push({ silentMs: presence.silentMs, viaBus: presence.viaBus });
  await client.waitForSignalKind("signal", stepIs("approval"));
  await soloEdit("api.txt", "api: released");
}

async function reviewer() {
  let silent = false;
  const heartbeat = setInterval(() => {
    if (!silent) client.ping();
  }, 400);
  heartbeat.unref();
  try {
    await client.waitForSignalKind("signal", stepIs("A1"));
    await soloEdit("auth.txt", "review: approved");
    await client.sendSignal("producer", { step: "B1" });
    await sharedEdit("shared-config.txt", "config: theme=dark", "shared-config");
    await soloEdit("ui.txt", "ui: dark-mode");
    await client.waitForSignalKind("signal", stepIs("A3"));
    await soloEdit("api.txt", "review: api approved");
    await sharedEdit("changelog.txt", "change: ui dark-mode", "changelog");
    silent = true;
    await sleep(BLOCK_MS);
    silent = false;
    await client.sendSignal("producer", { step: "approval" });
  } finally {
    clearInterval(heartbeat);
  }
}

const watchdog = setTimeout(() => {
  writeFileSync(
    path.join(WORKSPACE, `result-${AGENT}.json`),
    JSON.stringify({ agent: AGENT, error: "watchdog timeout", metrics }, null, 2),
  );
  process.exit(3);
}, 90_000);
watchdog.unref();

try {
  if (AGENT === "producer") await producer();
  else await reviewer();
  writeFileSync(
    path.join(WORKSPACE, `result-${AGENT}.json`),
    JSON.stringify(
      { agent: AGENT, wallMs: Date.now() - t0, fallbackUsed: client.usingFallback, metrics },
      null,
      2,
    ),
  );
  client.close();
  process.exit(0);
} catch (error) {
  writeFileSync(
    path.join(WORKSPACE, `result-${AGENT}.json`),
    JSON.stringify({ agent: AGENT, error: String(error), metrics }, null, 2),
  );
  process.exit(1);
}
