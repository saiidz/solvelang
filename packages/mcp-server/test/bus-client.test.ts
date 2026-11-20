import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BusClient } from "../src/bus-client.js";
import { startBusDaemon } from "../src/bus-daemon.js";
import {
  BusKeyRegistry,
  createBusMessage,
  parsePrivateKeyJson,
  signBusMessage,
  type BusPrivateKey,
} from "../src/bus-envelope.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function tempWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "solvelang-bus-client-"));
}

interface TestKey {
  privateKey: BusPrivateKey;
  entry: { id: string; algorithm: "ed25519"; public_key: string; status: "active" | "revoked" };
}

function makeKey(id: string): TestKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const parsed = parsePrivateKeyJson({
    format: "solvelang.private-key",
    version: 1,
    id,
    algorithm: "ed25519",
    private_key: Buffer.from(jwk.d, "base64url").toString("base64"),
  });
  return {
    privateKey: parsed,
    entry: { id, algorithm: "ed25519", public_key: Buffer.from(jwk.x, "base64url").toString("base64"), status: "active" },
  };
}

test("bus client: signals flow through the daemon with body and ref intact", async () => {
  const workspace = tempWorkspace();
  const daemon = await startBusDaemon({ logPath: path.join(workspace, "bus.jsonl") });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port, workspaceDir: workspace });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port, workspaceDir: workspace });
  try {
    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "A1");
    const sent = await producer.sendSignal("reviewer", { step: "A1" }, "sch_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const received = await waiting;
    assert.equal(received.id, sent.id);
    assert.equal(received.fromAgent, "producer");
    assert.equal(received.ref, "sch_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    assert.equal(producer.usingFallback, false);
    assert.equal(reviewer.usingFallback, false);
  } finally {
    producer.close();
    reviewer.close();
    await daemon.close();
  }
});

test("bus client: daemon death mid-wait falls back to handoff documents with no state loss", async () => {
  const workspace = tempWorkspace();
  const daemon = await startBusDaemon({ logPath: path.join(workspace, "bus.jsonl") });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port, workspaceDir: workspace });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port, workspaceDir: workspace });
  try {
    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "approval");
    await sleep(150);
    await daemon.close(); // SIGKILL-equivalent from the clients' side: sockets destroyed
    await sleep(150); // both clients notice the dead bus

    // The producer's send now travels by document alone — and lands.
    const sent = await producer.sendSignal("reviewer", { step: "approval" });
    const received = await waiting;
    assert.equal(received.id, sent.id);
    assert.equal((received.body as { step: string }).step, "approval");
    assert.equal(producer.usingFallback, true);
    assert.equal(reviewer.usingFallback, true);
  } finally {
    producer.close();
    reviewer.close();
  }
});

test("bus client: with no daemon at all, clients run on documents alone (kill switch as a starting state)", async () => {
  const workspace = tempWorkspace();
  // Nothing listens on this port: connect degrades instead of throwing.
  const producer = await BusClient.connect({ agent: "producer", port: 1, workspaceDir: workspace });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: 1, workspaceDir: workspace, pollMs: 100 });
  try {
    assert.equal(producer.connected, false);
    assert.equal(producer.usingFallback, true);

    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "A1");
    await producer.sendSignal("reviewer", { step: "A1" });
    const received = await waiting;
    assert.equal((received.body as { step: string }).step, "A1");

    // Document claims: earlier unexpired claim wins, release frees.
    const first = await producer.claim("shared-config", 5_000);
    assert.deepEqual(first, { granted: true, viaBus: false });
    const second = await reviewer.claim("shared-config", 5_000);
    assert.equal(second.granted, false);
    assert.equal(second.holder, "producer");
    assert.equal(second.viaBus, false);
    await producer.release("shared-config");
    const third = await reviewer.claim("shared-config", 5_000);
    assert.equal(third.granted, true);
  } finally {
    producer.close();
    reviewer.close();
  }
});

test("bus client: registry-mode consumers refuse forged and tampered pushes", async () => {
  const workspace = tempWorkspace();
  // Transport daemon is local-open; authenticity is enforced by the
  // consuming client against its registry — defence at both layers
  // is covered for the daemon layer in bus-daemon.test.ts.
  const daemon = await startBusDaemon({ logPath: path.join(workspace, "bus.jsonl") });
  const producerKey = makeKey("producer_key");
  const strangerKey = makeKey("stranger_key");
  const registry = BusKeyRegistry.fromJson({
    format: "solvelang.key-registry",
    version: 1,
    keys: [producerKey.entry],
  });
  const refusals: Array<{ code: string }> = [];
  const producer = await BusClient.connect({
    agent: "producer",
    port: daemon.port,
    workspaceDir: workspace,
    privateKey: producerKey.privateKey,
    registry,
  });
  const reviewer = await BusClient.connect({
    agent: "reviewer",
    port: daemon.port,
    workspaceDir: workspace,
    registry,
    // Keep the document sweep out of this test: refusals under
    // assertion here arrive on the push path only.
    pollMs: 60_000,
    onRefused: (info) => refusals.push({ code: info.code }),
  });
  const stranger = await BusClient.connect({
    agent: "producer",
    port: daemon.port,
    workspaceDir: workspace,
    privateKey: strangerKey.privateKey,
  });
  try {
    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "real");

    // Forged: valid envelope, signed by an unregistered key.
    await stranger.sendSignal("reviewer", { step: "real" });
    await sleep(300);
    assert.deepEqual(refusals.map((refusal) => refusal.code), ["bus_unknown_signer"]);

    // Tampered: a genuine signature replayed over an altered
    // timestamp — relayed raw so the client sees it as a push.
    const genuine = signBusMessage(
      createBusMessage({ fromAgent: "producer", toAgent: "reviewer", kind: "signal", body: { step: "real" } }),
      producerKey.privateKey,
    );
    const tampered = { ...genuine, ts: genuine.ts + 1 };
    const raw: Socket = netConnect(daemon.port, "127.0.0.1");
    await new Promise<void>((resolve) => raw.on("connect", resolve));
    raw.write(`${JSON.stringify({ op: "subscribe", agent: "producer", _seq: 1 })}\n`);
    await sleep(100);
    raw.write(`${JSON.stringify({ op: "send", msg: tampered, _seq: 2 })}\n`);
    await sleep(300);
    assert.deepEqual(refusals.map((refusal) => refusal.code), ["bus_unknown_signer", "bus_signature_invalid"]);
    raw.destroy();

    // The genuine message still completes the wait.
    await producer.sendSignal("reviewer", { step: "real" });
    const received = await waiting;
    assert.equal((received.body as { step: string }).step, "real");
    assert.equal(received.signer, "producer_key");
  } finally {
    producer.close();
    reviewer.close();
    stranger.close();
    await daemon.close();
  }
});

test("bus client: presence reports the peer's last-seen through the daemon", async () => {
  const workspace = tempWorkspace();
  const daemon = await startBusDaemon({ logPath: path.join(workspace, "bus.jsonl") });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port, workspaceDir: workspace });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port, workspaceDir: workspace });
  try {
    reviewer.ping();
    await sleep(100);
    const presence = await producer.presence("reviewer");
    assert.equal(presence.viaBus, true);
    assert.notEqual(presence.lastSeen, null);
    assert.ok(presence.silentMs !== null && presence.silentMs < 5_000);
    const unknown = await producer.presence("ghost");
    assert.equal(unknown.lastSeen, null);
    assert.equal(unknown.silentMs, null);
  } finally {
    producer.close();
    reviewer.close();
    await daemon.close();
  }
});
