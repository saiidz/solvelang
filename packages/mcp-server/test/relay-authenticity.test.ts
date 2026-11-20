import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import test from "node:test";
import {
  createBusMessage,
  parsePrivateKeyJson,
  signBusMessage,
  type BusMessage,
  type BusPrivateKey,
} from "../src/bus-envelope.js";
import {
  createRelayHttpServer,
  normalizeRelayConfig,
  relayTokenSha256,
  type RelayConfig,
} from "../src/relay.js";

const TOKEN_A = "relay-auth-token-agent-a-0000000001";
const TOKEN_B = "relay-auth-token-agent-b-0000000002";
const OPEN_TOKEN = "relay-auth-token-open-a-000000009";

function privateKey(id: string): BusPrivateKey {
  return parsePrivateKeyJson({
    format: "solvelang.private-key",
    version: 1,
    id,
    algorithm: "ed25519",
    private_key: randomBytes(32).toString("base64"),
  });
}

const active = privateKey("key-active");
const revoked = privateKey("key-revoked");
const stranger = privateKey("key-stranger");

function registryDocument(): Record<string, unknown> {
  return {
    format: "solvelang.key-registry",
    version: 1,
    keys: [
      { id: "key-active", algorithm: "ed25519", public_key: active.publicKey.toString("base64"), status: "active" },
      { id: "key-revoked", algorithm: "ed25519", public_key: revoked.publicKey.toString("base64"), status: "revoked" },
    ],
  };
}

function config(): RelayConfig {
  return normalizeRelayConfig({
    workspaces: [
      {
        id: "signed-ws",
        requireSignatures: true,
        registry: registryDocument(),
        tokens: [
          { agent: "agent-a", tokenSha256: relayTokenSha256(TOKEN_A) },
          { agent: "agent-b", tokenSha256: relayTokenSha256(TOKEN_B) },
        ],
      },
      {
        id: "open-ws",
        requireSignatures: false,
        registry: {
          format: "solvelang.key-registry",
          version: 1,
          keys: [{ id: "key-active", algorithm: "ed25519", public_key: active.publicKey.toString("base64"), status: "active" }],
        },
        tokens: [{ agent: "agent-a", tokenSha256: relayTokenSha256(OPEN_TOKEN) }],
      },
    ],
  });
}

async function boot(): Promise<{ server: HttpServer; base: string }> {
  const server = createRelayHttpServer({ config: config() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function post(base: string, token: string, envelope: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(base + "/relay/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

function signed(key: BusPrivateKey, input: Parameters<typeof createBusMessage>[0]): BusMessage {
  return signBusMessage(createBusMessage(input), key);
}

test("a correctly signed message is relayed and delivered", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const envelope = signed(active, { fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "done" } });
  const posted = await post(base, TOKEN_A, envelope);
  assert.equal(posted.status, 200);

  const inbox = await fetch(base + "/relay/messages?since=0", { headers: { Authorization: `Bearer ${TOKEN_B}` } });
  const inboxJson: any = await inbox.json();
  assert.deepEqual(inboxJson.messages.map((m: any) => m.id), [envelope.id]);
});

test("unsigned, unknown, revoked, and tampered messages are refused with bus codes, never relayed", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const unsigned = createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal" });
  const unsignedResult = await post(base, TOKEN_A, unsigned);
  assert.equal(unsignedResult.status, 403);
  assert.equal(unsignedResult.json.error, "bus_unsigned");

  const unknown = signed(stranger, { fromAgent: "agent-a", toAgent: "agent-b", kind: "signal" });
  const unknownResult = await post(base, TOKEN_A, unknown);
  assert.equal(unknownResult.status, 403);
  assert.equal(unknownResult.json.error, "bus_unknown_signer");

  const revokedSigned = signed(revoked, { fromAgent: "agent-a", toAgent: "agent-b", kind: "signal" });
  const revokedResult = await post(base, TOKEN_A, revokedSigned);
  assert.equal(revokedResult.status, 403);
  assert.equal(revokedResult.json.error, "bus_signer_revoked");

  // Tamper after signing: a new body (honestly re-hashed id), carrying
  // the original signature — the signature no longer covers the payload.
  const original = signed(active, { fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "done" } });
  const tamperedCore = createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "forged" } });
  const tampered: BusMessage = { ...tamperedCore, signer: original.signer, sig: original.sig };
  const tamperedResult = await post(base, TOKEN_A, tampered);
  assert.equal(tamperedResult.status, 403);
  assert.equal(tamperedResult.json.error, "bus_signature_invalid");

  const garbageSig: BusMessage = { ...createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal" }), signer: "key-active", sig: "not-a-signature" };
  const garbageResult = await post(base, TOKEN_A, garbageSig);
  assert.equal(garbageResult.status, 403);
  assert.equal(garbageResult.json.error, "bus_signature_invalid");

  const inbox = await fetch(base + "/relay/messages?since=0", { headers: { Authorization: `Bearer ${TOKEN_B}` } });
  const inboxJson: any = await inbox.json();
  assert.deepEqual(inboxJson.messages, []);
});

test("in an open workspace a presented-but-invalid signature is still refused", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const plain = createBusMessage({ fromAgent: "agent-a", toAgent: "*", kind: "signal" });
  assert.equal((await post(base, OPEN_TOKEN, plain)).status, 200);

  const good = signed(active, { fromAgent: "agent-a", toAgent: "*", kind: "signal", body: { n: 1 } });
  assert.equal((await post(base, OPEN_TOKEN, good)).status, 200);

  const badCore = createBusMessage({ fromAgent: "agent-a", toAgent: "*", kind: "signal", body: { n: 2 } });
  const bad: BusMessage = { ...badCore, signer: good.signer, sig: good.sig };
  const badResult = await post(base, OPEN_TOKEN, bad);
  assert.equal(badResult.status, 403);
  assert.equal(badResult.json.error, "bus_signature_invalid");
});
