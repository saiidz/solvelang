import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  BUS_CODES,
  BusDedup,
  BusError,
  BusKeyRegistry,
  busCanonicalPayload,
  createBusMessage,
  parsePrivateKeyJson,
  signBusMessage,
  signBusPayload,
  validateBusMessage,
  verifyBusMessage,
  verifyBusPayload,
  type BusPrivateKey,
} from "../src/bus-envelope.js";

// Key material is generated in-test only; nothing here is a real key.
// The artifact shapes are byte-for-byte the Phase 4 formats
// (`solvelang.key-registry` v1 / `solvelang.private-key` v1), so a
// keypair created by `solvec keygen` for signed gates is a bus
// signing key without conversion.

interface TestKey {
  id: string;
  privateKey: BusPrivateKey;
  registryEntry: { id: string; algorithm: "ed25519"; public_key: string; status: "active" | "revoked" };
}

function makeKey(id: string, status: "active" | "revoked" = "active"): TestKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  const parsed = parsePrivateKeyJson({
    format: "solvelang.private-key",
    version: 1,
    id,
    algorithm: "ed25519",
    private_key: seed.toString("base64"),
  });
  assert.deepEqual(parsed.publicKey, pub, "seed-derived public key must match the generated pair");
  return {
    id,
    privateKey: parsed,
    registryEntry: { id, algorithm: "ed25519", public_key: pub.toString("base64"), status },
  };
}

function registryOf(...keys: TestKey[]): BusKeyRegistry {
  return BusKeyRegistry.fromJson({
    format: "solvelang.key-registry",
    version: 1,
    keys: keys.map((key) => key.registryEntry),
  });
}

test("bus envelope: id is the content hash of the core and validates", () => {
  const message = createBusMessage({
    fromAgent: "claude",
    toAgent: "codex",
    kind: "signal",
    body: { step: "A1" },
    ts: 1_700_000_000_000,
  });
  assert.match(message.id, /^sch_[a-f0-9]{64}$/);
  assert.equal(message.signer, null);
  assert.equal(message.sig, "");
  assert.deepEqual(validateBusMessage(JSON.parse(JSON.stringify(message))), message);

  const tamperedBody = { ...message, body: { step: "A2" } };
  assert.throws(
    () => validateBusMessage(tamperedBody),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.ID_MISMATCH,
  );
  const malformed = { ...message, kind: "shout" };
  assert.throws(
    () => validateBusMessage(malformed),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.MALFORMED,
  );
});

test("bus envelope: canonical payload is a pinned byte record in the Phase 4 style", () => {
  const key = makeKey("producer_key");
  const message = signBusMessage(
    createBusMessage({
      fromAgent: "producer",
      toAgent: "reviewer",
      kind: "signal",
      body: { step: "A1" },
      ref: "sch_0123456789abcdef0123456789abcdef",
      ts: 1_700_000_000_123,
    }),
    key.privateKey,
  );
  const payload = busCanonicalPayload(message);
  const lines = payload.split("\n");
  assert.equal(lines[0], "solvelang-bus-signature-v1");
  assert.equal(lines[1], `id:${message.id}`);
  assert.equal(lines[2], "from:producer");
  assert.equal(lines[3], "to:reviewer");
  assert.equal(lines[4], "kind:signal");
  assert.equal(lines[5], "ts:1700000000123");
  assert.match(lines[6], /^body-sha256:[a-f0-9]{64}$/);
  assert.equal(lines[7], "ref:sch_0123456789abcdef0123456789abcdef");
  assert.equal(lines[8], "signer:producer_key");
  assert.equal(lines[9], "");
  assert.ok(payload.endsWith("\n"));
});

test("bus envelope: Ed25519 verification matches RFC 8032 test vector 1", () => {
  // RFC 8032 §7.1, TEST 1: public key and signature of the empty
  // message. This pins the byte formats (raw 32-byte key, raw 64-byte
  // signature) against the standard every Ed25519 implementation —
  // including Phase 4's ed25519-dalek — implements.
  const publicKey = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
  const signature = Buffer.from(
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
      "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    "hex",
  );
  assert.equal(verifyBusPayload("", signature.toString("base64"), publicKey), true);
  assert.equal(verifyBusPayload("x", signature.toString("base64"), publicKey), false);
  assert.equal(verifyBusPayload("", Buffer.alloc(64).toString("base64"), publicKey), false);
});

test("bus signing: accept/refuse matrix is fail-closed with distinct codes", () => {
  const producer = makeKey("producer_key");
  const stranger = makeKey("stranger_key");
  const revoked = makeKey("revoked_key", "revoked");
  const registry = registryOf(producer, revoked);
  const base = createBusMessage({
    fromAgent: "producer",
    toAgent: "reviewer",
    kind: "signal",
    body: { step: "A1" },
    ts: 1_700_000_000_000,
  });

  // Valid signature from a registered, active key.
  assert.deepEqual(verifyBusMessage(signBusMessage(base, producer.privateKey), registry), { ok: true });

  // Unsigned.
  assert.deepEqual(verifyBusMessage(base, registry), {
    ok: false,
    code: BUS_CODES.UNSIGNED,
    message: "bus message carries no signature; registry mode requires one.",
  });

  // Signed by a key the registry does not know.
  const strangerVerdict = verifyBusMessage(signBusMessage(base, stranger.privateKey), registry);
  assert.equal(strangerVerdict.ok, false);
  assert.equal(strangerVerdict.ok === false && strangerVerdict.code, BUS_CODES.UNKNOWN_SIGNER);

  // Signed by a revoked key.
  const revokedVerdict = verifyBusMessage(signBusMessage(base, revoked.privateKey), registry);
  assert.equal(revokedVerdict.ok, false);
  assert.equal(revokedVerdict.ok === false && revokedVerdict.code, BUS_CODES.SIGNER_REVOKED);

  // Body tampered after signing (signature no longer covers the body hash).
  const signed = signBusMessage(base, producer.privateKey);
  const tampered = { ...signed, body: { step: "forged" } };
  const tamperedVerdict = verifyBusMessage(tampered, registry);
  assert.equal(tamperedVerdict.ok, false);
  assert.equal(tamperedVerdict.ok === false && tamperedVerdict.code, BUS_CODES.SIGNATURE_INVALID);

  // Timestamp tampered after signing: the id (content core) still
  // validates, but ts is signature-covered, so authenticity fails.
  const tsTampered = { ...signed, ts: signed.ts + 1 };
  assert.deepEqual(validateBusMessage(tsTampered).id, signed.id);
  const tsVerdict = verifyBusMessage(tsTampered, registry);
  assert.equal(tsVerdict.ok, false);
  assert.equal(tsVerdict.ok === false && tsVerdict.code, BUS_CODES.SIGNATURE_INVALID);

  // Signature transplanted onto a different message.
  const other = createBusMessage({
    fromAgent: "producer",
    toAgent: "reviewer",
    kind: "signal",
    body: { step: "other" },
    ts: 1_700_000_000_000,
  });
  const transplanted = { ...other, signer: signed.signer, sig: signed.sig };
  const transplantVerdict = verifyBusMessage(transplanted, registry);
  assert.equal(transplantVerdict.ok, false);
  assert.equal(transplantVerdict.ok === false && transplantVerdict.code, BUS_CODES.SIGNATURE_INVALID);

  // signBusPayload is deterministic Ed25519 over the exact payload bytes.
  const payload = busCanonicalPayload(signed);
  assert.equal(signBusPayload(payload, producer.privateKey.key), signed.sig);
});

test("bus keys: registry and private-key artifacts refuse malformed input", () => {
  assert.throws(
    () => BusKeyRegistry.fromJson({ format: "other.format", version: 1, keys: [] }),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.MALFORMED,
  );
  assert.throws(
    () =>
      BusKeyRegistry.fromJson({
        format: "solvelang.key-registry",
        version: 1,
        keys: [{ id: "k", algorithm: "ed25519", public_key: Buffer.alloc(31).toString("base64"), status: "active" }],
      }),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.MALFORMED,
  );
  assert.throws(
    () =>
      parsePrivateKeyJson({
        format: "solvelang.private-key",
        version: 1,
        id: "k",
        algorithm: "ed25519",
        private_key: Buffer.alloc(16).toString("base64"),
      }),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.MALFORMED,
  );
  const key = makeKey("dup_key");
  assert.throws(
    () => registryOf(key, key),
    (error: unknown) => error instanceof BusError && error.code === BUS_CODES.MALFORMED,
  );
});

test("bus dedup: duplicates collapse by content-hash id", () => {
  const dedup = new BusDedup();
  const message = createBusMessage({ fromAgent: "a", toAgent: "b", kind: "ping", ts: 1 });
  assert.equal(dedup.accept(message), true);
  assert.equal(dedup.accept(message), false);
  assert.equal(dedup.accept({ ...message }), false);
  const other = createBusMessage({ fromAgent: "a", toAgent: "b", kind: "pong", ts: 1 });
  assert.equal(dedup.accept(other), true);
});
