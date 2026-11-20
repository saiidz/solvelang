import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import test from "node:test";
import {
  createRelayEnvelope,
  createRelayHttpServer,
  normalizeRelayConfig,
  relaySignaturePayload,
  relayTokenSha256,
  type RelayConfig,
  type RelayEnvelope,
} from "../src/relay.js";

const TOKEN_A = "relay-auth-token-agent-a-0000000001";
const TOKEN_B = "relay-auth-token-agent-b-0000000002";

function keypair(): { privateKey: KeyObject; publicKeyBase64: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, publicKeyBase64: Buffer.from(der).subarray(der.length - 32).toString("base64") };
}

const active = keypair();
const revoked = keypair();
const stranger = keypair();

function signedEnvelope(privateKey: KeyObject, keyId: string, input: Parameters<typeof createRelayEnvelope>[0]): RelayEnvelope {
  const unsigned = createRelayEnvelope(input);
  const signature = cryptoSign(null, Buffer.from(relaySignaturePayload(unsigned, keyId), "utf8"), privateKey);
  return { ...unsigned, sig: `ed25519:${keyId}:${signature.toString("base64")}` };
}

function config(): RelayConfig {
  return normalizeRelayConfig({
    workspaces: [
      {
        id: "signed-ws",
        requireSignatures: true,
        keys: [
          { id: "key-active", algorithm: "ed25519", public_key: active.publicKeyBase64, status: "active" },
          { id: "key-revoked", algorithm: "ed25519", public_key: revoked.publicKeyBase64, status: "revoked" },
        ],
        tokens: [
          { agent: "agent-a", tokenSha256: relayTokenSha256(TOKEN_A) },
          { agent: "agent-b", tokenSha256: relayTokenSha256(TOKEN_B) },
        ],
      },
      {
        id: "open-ws",
        requireSignatures: false,
        keys: [{ id: "key-active", algorithm: "ed25519", public_key: active.publicKeyBase64, status: "active" }],
        tokens: [{ agent: "agent-a", tokenSha256: relayTokenSha256("relay-auth-token-open-a-000000009") }],
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

test("a correctly signed message is relayed and delivered", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const envelope = signedEnvelope(active.privateKey, "key-active", {
    fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "done" },
  });
  const posted = await post(base, TOKEN_A, envelope);
  assert.equal(posted.status, 200);

  const inbox = await fetch(base + "/relay/messages?since=0", { headers: { Authorization: `Bearer ${TOKEN_B}` } });
  const inboxJson: any = await inbox.json();
  assert.deepEqual(inboxJson.messages.map((m: any) => m.id), [envelope.id]);
});

test("unsigned, malformed, unknown, revoked, and tampered messages are refused, never relayed", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());

  const unsigned = createRelayEnvelope({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal" });
  const unsignedResult = await post(base, TOKEN_A, unsigned);
  assert.equal(unsignedResult.status, 403);
  assert.equal(unsignedResult.json.error, "signature_required");

  const malformed = { ...unsigned, sig: "ed25519:key-active:not-a-signature" };
  const malformedResult = await post(base, TOKEN_A, malformed);
  assert.equal(malformedResult.status, 403);
  assert.equal(malformedResult.json.error, "signature_malformed");

  const unknown = signedEnvelope(stranger.privateKey, "key-stranger", {
    fromAgent: "agent-a", toAgent: "agent-b", kind: "signal",
  });
  const unknownResult = await post(base, TOKEN_A, unknown);
  assert.equal(unknownResult.status, 403);
  assert.equal(unknownResult.json.error, "unknown_signer");

  const revokedSigned = signedEnvelope(revoked.privateKey, "key-revoked", {
    fromAgent: "agent-a", toAgent: "agent-b", kind: "signal",
  });
  const revokedResult = await post(base, TOKEN_A, revokedSigned);
  assert.equal(revokedResult.status, 403);
  assert.equal(revokedResult.json.error, "signer_revoked");

  // Tamper after signing: the body changes, the id is honestly recomputed,
  // but the signature still names the original id — verification must fail.
  const signed = signedEnvelope(active.privateKey, "key-active", {
    fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "done" },
  });
  const tamperedCore = createRelayEnvelope({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "forged" } });
  const tampered = { ...tamperedCore, sig: signed.sig };
  const tamperedResult = await post(base, TOKEN_A, tampered);
  assert.equal(tamperedResult.status, 403);
  assert.equal(tamperedResult.json.error, "signature_invalid");

  const inbox = await fetch(base + "/relay/messages?since=0", { headers: { Authorization: `Bearer ${TOKEN_B}` } });
  const inboxJson: any = await inbox.json();
  assert.deepEqual(inboxJson.messages, []);
});

test("in an open workspace a presented-but-invalid signature is still refused", async (t) => {
  const { server, base } = await boot();
  t.after(() => server.close());
  const openToken = "relay-auth-token-open-a-000000009";

  const plain = createRelayEnvelope({ fromAgent: "agent-a", toAgent: "*", kind: "signal" });
  assert.equal((await post(base, openToken, plain)).status, 200);

  const signed = signedEnvelope(active.privateKey, "key-active", {
    fromAgent: "agent-a", toAgent: "*", kind: "signal", body: { n: 1 },
  });
  assert.equal((await post(base, openToken, signed)).status, 200);

  const badCore = createRelayEnvelope({ fromAgent: "agent-a", toAgent: "*", kind: "signal", body: { n: 2 } });
  const bad = { ...badCore, sig: signed.sig };
  const badResult = await post(base, openToken, bad);
  assert.equal(badResult.status, 403);
  assert.equal(badResult.json.error, "signature_invalid");
});
