import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BusClient } from "../src/bus-client.js";
import { startBusDaemon, type BusDaemonHandle } from "../src/bus-daemon.js";
import {
  BusKeyRegistry,
  createBusMessage,
  parsePrivateKeyJson,
  signBusMessage,
  type BusPrivateKey,
} from "../src/bus-envelope.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function tempLog(): { dir: string; logPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "solvelang-bus-daemon-"));
  return { dir, logPath: path.join(dir, "bus.jsonl") };
}

function readEvents(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

/** Minimal raw protocol client for refusal-path probes. */
class RawBus {
  #socket!: Socket;
  #buffer = "";
  #seq = 0;
  readonly #pending = new Map<string, (reply: Record<string, unknown>) => void>();
  readonly pushes: unknown[] = [];

  static async connect(port: number): Promise<RawBus> {
    const raw = new RawBus();
    raw.#socket = netConnect(port, "127.0.0.1");
    raw.#socket.on("data", (chunk) => {
      raw.#buffer += chunk.toString("utf8");
      let index: number;
      while ((index = raw.#buffer.indexOf("\n")) >= 0) {
        const line = raw.#buffer.slice(0, index);
        raw.#buffer = raw.#buffer.slice(index + 1);
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Record<string, unknown>;
        if (value.push !== undefined) raw.pushes.push(value.push);
        else if (typeof value.op === "string" && typeof value._seq === "number") {
          const pending = raw.#pending.get(`${value.op}:${value._seq}`);
          if (pending) {
            raw.#pending.delete(`${value.op}:${value._seq}`);
            pending(value);
          }
        }
      }
    });
    await new Promise<void>((resolve) => raw.#socket.on("connect", resolve));
    return raw;
  }

  request(value: Record<string, unknown>): Promise<Record<string, unknown>> {
    const seq = ++this.#seq;
    return new Promise((resolve) => {
      this.#pending.set(`${value.op}:${seq}`, resolve);
      this.#socket.write(`${JSON.stringify({ ...value, _seq: seq })}\n`);
    });
  }

  close(): void {
    this.#socket.destroy();
  }
}

test("bus daemon: claims grant, deny, renew by holder, release, and expire", async () => {
  const { logPath } = tempLog();
  const daemon = await startBusDaemon({ logPath });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port });
  try {
    const first = await producer.claim("shared-config", 5_000);
    assert.deepEqual(first, { granted: true, viaBus: true });

    const denied = await reviewer.claim("shared-config", 5_000);
    assert.equal(denied.granted, false);
    assert.equal(denied.holder, "producer");
    assert.equal(denied.viaBus, true);

    // The holder re-claiming renews the lease instead of denying itself.
    const renewed = await producer.claim("shared-config", 5_000);
    assert.equal(renewed.granted, true);

    await producer.release("shared-config");
    const afterRelease = await reviewer.claim("shared-config", 5_000);
    assert.equal(afterRelease.granted, true);
    await reviewer.release("shared-config");

    // Expiry frees the item without any release.
    const short = await producer.claim("changelog", 200);
    assert.equal(short.granted, true);
    await sleep(400);
    const afterExpiry = await reviewer.claim("changelog", 5_000);
    assert.equal(afterExpiry.granted, true);

    const events = readEvents(logPath).map((entry) => entry.event);
    for (const expected of ["claim_granted", "claim_denied", "claim_released", "claim_expired"]) {
      assert.ok(events.includes(expected), `audit log must record ${expected}`);
    }
  } finally {
    producer.close();
    reviewer.close();
    await daemon.close();
  }
});

test("bus daemon: duplicate deliveries collapse in the consumer by content-hash id", async () => {
  const { logPath } = tempLog();
  const daemon = await startBusDaemon({ logPath, duplicateDeliveries: true });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port });
  try {
    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "A1");
    await producer.sendSignal("reviewer", { step: "A1" });
    const message = await waiting;
    assert.equal((message.body as { step: string }).step, "A1");

    // The daemon delivered the push twice; a second wait for the same
    // signal must NOT resolve — the duplicate was deduped by id.
    const second = await Promise.race([
      reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "A1").then(() => "resolved"),
      sleep(500).then(() => "timeout"),
    ]);
    assert.equal(second, "timeout");
  } finally {
    producer.close();
    reviewer.close();
    await daemon.close();
  }
});

test("bus daemon: audit log is append-only and rotation bounds its size", async () => {
  const { dir, logPath } = tempLog();
  const sentinel = JSON.stringify({ t: 1, event: "sentinel" });
  writeFileSync(logPath, `${sentinel}\n`);
  const daemon = await startBusDaemon({ logPath, maxLogBytes: 1_500, maxLogArchives: 2 });
  const producer = await BusClient.connect({ agent: "producer", port: daemon.port });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: daemon.port });
  try {
    for (let index = 0; index < 40; index++) {
      await producer.sendSignal("reviewer", { step: `S${index}`, padding: "x".repeat(40) });
    }
    // Rotation happened and the total footprint stays bounded.
    assert.ok(existsSync(`${logPath}.1`), "rotation must produce an archive segment");
    let total = 0;
    for (const candidate of [logPath, `${logPath}.1`, `${logPath}.2`]) {
      if (existsSync(candidate)) total += statSync(candidate).size;
    }
    assert.ok(total <= 1_500 * 3 + 1_500, `audit segments must stay bounded (got ${total})`);
    assert.ok(!existsSync(`${logPath}.3`), "archives beyond the bound must be deleted");
    const rotated = readEvents(logPath).some((entry) => entry.event === "log_rotated");
    assert.ok(rotated, "rotation itself is recorded in the new segment");
    // The daemon is still fully functional after rotations.
    const status = daemon.status();
    assert.equal(status.authMode, "local-open");
    void dir;
  } finally {
    producer.close();
    reviewer.close();
    await daemon.close();
  }

  // Append-only across restarts: a fresh daemon on an existing log
  // never rewrites earlier lines.
  const before = readFileSync(logPath, "utf8");
  const again = await startBusDaemon({ logPath });
  await again.close();
  const after = readFileSync(logPath, "utf8");
  assert.ok(after.startsWith(before), "restart must append, never rewrite");
  assert.ok(after.length > before.length, "restart records its own daemon_start");
});

test("bus daemon: restart recovers live claims and presence from the audit log", async () => {
  const { logPath } = tempLog();
  const first = await startBusDaemon({ logPath });
  const producer = await BusClient.connect({ agent: "producer", port: first.port });
  const held = await producer.claim("shared-config", 60_000);
  assert.equal(held.granted, true);
  const expiring = await producer.claim("changelog", 200);
  assert.equal(expiring.granted, true);
  producer.close();
  await first.close();
  await sleep(300); // the changelog lease lapses while the daemon is down

  const second: BusDaemonHandle = await startBusDaemon({ logPath });
  const reviewer = await BusClient.connect({ agent: "reviewer", port: second.port });
  try {
    // The unexpired claim survived the restart; the lapsed one did not.
    const stillHeld = await reviewer.claim("shared-config", 5_000);
    assert.equal(stillHeld.granted, false);
    assert.equal(stillHeld.holder, "producer");
    const lapsed = await reviewer.claim("changelog", 5_000);
    assert.equal(lapsed.granted, true);
    // Presence recovered from the trail: producer was seen.
    const presence = await reviewer.presence("producer");
    assert.equal(presence.viaBus, true);
    assert.notEqual(presence.lastSeen, null);
  } finally {
    reviewer.close();
    await second.close();
  }
});

test("bus daemon: registry mode refuses unsigned, unknown, and mismatched senders fail-closed", async () => {
  const { logPath } = tempLog();
  const producerKey = makeKey("producer_key");
  const reviewerKey = makeKey("reviewer_key");
  const strangerKey = makeKey("stranger_key");
  const registry = BusKeyRegistry.fromJson({
    format: "solvelang.key-registry",
    version: 1,
    keys: [producerKey.entry, reviewerKey.entry],
  });
  const daemon = await startBusDaemon({ logPath, registry });
  assert.equal(daemon.authMode, "registry");

  const producer = await BusClient.connect({
    agent: "producer",
    port: daemon.port,
    privateKey: producerKey.privateKey,
    registry,
  });
  const reviewer = await BusClient.connect({
    agent: "reviewer",
    port: daemon.port,
    privateKey: reviewerKey.privateKey,
    registry,
  });
  const unsigned = await BusClient.connect({ agent: "lurker", port: daemon.port, registry });
  const raw = await RawBus.connect(daemon.port);
  try {
    // Signed send flows.
    const waiting = reviewer.waitForSignalKind("signal", (body) => (body as { step?: string })?.step === "ok");
    await producer.sendSignal("reviewer", { step: "ok" });
    await waiting;

    // Unsigned send is refused by the daemon and surfaces to the caller.
    await assert.rejects(
      () => unsigned.sendSignal("reviewer", { step: "nope" }),
      (error: unknown) => (error as { code?: string }).code === "bus_unsigned",
    );

    // Raw probes: unknown signer and sender mismatch get distinct codes.
    await raw.request({ op: "subscribe", agent: "producer" });
    const forged = signBusMessage(
      createBusMessage({ fromAgent: "producer", toAgent: "reviewer", kind: "signal", body: { step: "x" } }),
      strangerKey.privateKey,
    );
    const unknownReply = await raw.request({ op: "send", msg: forged });
    assert.equal(unknownReply.ok, false);
    assert.equal(unknownReply.error, "bus_unknown_signer");

    const mismatched = signBusMessage(
      createBusMessage({ fromAgent: "reviewer", toAgent: "reviewer", kind: "signal", body: { step: "x" } }),
      reviewerKey.privateKey,
    );
    const mismatchReply = await raw.request({ op: "send", msg: mismatched });
    assert.equal(mismatchReply.ok, false);
    assert.equal(mismatchReply.error, "bus_sender_mismatch");

    // Claims in registry mode need the signed envelope; the client
    // supplies it, a bare op does not pass.
    const bareClaim = await raw.request({ op: "claim", item: "shared-config" });
    assert.equal(bareClaim.ok, false);
    assert.equal(bareClaim.error, "bus_unsigned");
    const granted = await producer.claim("shared-config", 5_000);
    assert.equal(granted.granted, true);

    const refusals = readEvents(logPath).filter((entry) => entry.event === "message_refused");
    assert.ok(refusals.length >= 3, "every refusal is written to the audit log");
  } finally {
    raw.close();
    producer.close();
    reviewer.close();
    unsigned.close();
    await daemon.close();
  }
});
