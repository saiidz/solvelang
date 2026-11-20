import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

// Multi-agent bus message envelope (Phase 6). A bus message is the
// SolveLang context-handoff schema, extended for live transport
// (design: docs/integrations/multi-agent-bus.md): the id is a content
// hash (`sch_<sha256>`) over the message core, which gives integrity
// and makes consumers naturally idempotent — at-least-once delivery
// collapses by id. The id is NOT an authentication signature; sender
// authenticity comes from the `sig` field, which carries a Phase 4
// Ed25519 signature (see docs/signed-gates.md) over the canonical
// payload defined here, verified against the same
// `solvelang.key-registry` v1 registry world the gate runtime uses.
//
// The bus carries signals only. Anything that matters (decisions,
// diffs, evidence) still lands as a durable handoff document; the
// envelope's `ref` field points at such a document by its `sch_` id.

export const BUS_MESSAGE_SCHEMA = "solvelang.bus.message.v1" as const;
export const BUS_SIGNATURE_VERSION = "solvelang-bus-signature-v1" as const;
export const BUS_KEY_REGISTRY_FORMAT = "solvelang.key-registry" as const;
export const BUS_KEY_REGISTRY_VERSION = 1 as const;
export const BUS_PRIVATE_KEY_FORMAT = "solvelang.private-key" as const;
export const BUS_PRIVATE_KEY_VERSION = 1 as const;
export const BUS_ALGORITHM_ED25519 = "ed25519" as const;

/** Agent name the daemon itself uses for system signals. */
export const BUS_DAEMON_AGENT = "daemon" as const;

export const BUS_MESSAGE_KINDS = [
  "signal",
  "claim",
  "release",
  "propose",
  "accept",
  "reject",
  "ping",
  "pong",
] as const;
export type BusMessageKind = (typeof BUS_MESSAGE_KINDS)[number];
const BUS_KIND_SET: ReadonlySet<string> = new Set(BUS_MESSAGE_KINDS);

/**
 * How a bus endpoint treats message authenticity.
 *
 * - `"registry"`: a Phase 4 key registry is configured and every
 *   agent message must carry a valid signature from a registered,
 *   active key. This is the only mode with sender authenticity, and
 *   the only mode acceptable beyond a single trusted desktop.
 * - `"local-open"`: no registry is configured; messages are unsigned
 *   and carry integrity only (the content-hash id), never proof of
 *   sender. The mode is explicit and named: the daemon binds
 *   localhost only, announces the mode at startup and in its status,
 *   and it must never be used to coordinate across machines.
 */
export type BusAuthMode = "registry" | "local-open";
export const BUS_AUTH_REGISTRY: BusAuthMode = "registry";
export const BUS_AUTH_LOCAL_OPEN: BusAuthMode = "local-open";

/** Refusal codes, in the style of Phase 4's `gate_codes`. */
export const BUS_CODES = {
  /** Registry mode: the message carries no signature. */
  UNSIGNED: "bus_unsigned",
  /** The signer key id is not in the registry. */
  UNKNOWN_SIGNER: "bus_unknown_signer",
  /** The signer key is registered but revoked. */
  SIGNER_REVOKED: "bus_signer_revoked",
  /** The signature does not verify over the canonical payload. */
  SIGNATURE_INVALID: "bus_signature_invalid",
  /** The message is not a well-formed bus envelope. */
  MALFORMED: "bus_malformed",
  /** The content-hash id does not match the message core. */
  ID_MISMATCH: "bus_id_mismatch",
  /** The sending connection is subscribed as a different agent. */
  SENDER_MISMATCH: "bus_sender_mismatch",
  /** The connection sent a request before subscribing. */
  NOT_SUBSCRIBED: "bus_not_subscribed",
  /** Registry auth mode was requested without a registry. */
  UNCONFIGURED: "bus_unconfigured",
} as const;

export class BusError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BusError";
    this.code = code;
  }
}

export interface BusMessage {
  schema: typeof BUS_MESSAGE_SCHEMA;
  /** Content hash over the core: `sch_<sha256>`. Integrity, not authenticity. */
  id: string;
  fromAgent: string;
  /** An agent name, or `"*"` for a broadcast. */
  toAgent: string;
  kind: BusMessageKind;
  /** Sender clock, unix milliseconds. Covered by the signature. */
  ts: number;
  /** Any JSON value, or null. Substance belongs in a handoff document named by `ref`. */
  body: unknown;
  /** `sch_` id of the handoff document this signal is about, or null. */
  ref: string | null;
  /** Phase 4 key id that signed this message, or null when unsigned. */
  signer: string | null;
  /** Base64 Ed25519 signature over `busCanonicalPayload`, or "" when unsigned. */
  sig: string;
}

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonicalBusJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalBusJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalBusJson(entry)}`)
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface BusMessageCore {
  schema: typeof BUS_MESSAGE_SCHEMA;
  fromAgent: string;
  toAgent: string;
  kind: BusMessageKind;
  body: unknown;
  ref: string | null;
}

export function busMessageId(core: BusMessageCore): string {
  return `sch_${sha256Hex(canonicalBusJson(core))}`;
}

export interface CreateBusMessageInput {
  fromAgent: string;
  toAgent: string;
  kind: BusMessageKind;
  body?: unknown;
  ref?: string | null;
  /** Defaults to the current time; injectable for tests. */
  ts?: number;
}

function assertAgentName(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new BusError(BUS_CODES.MALFORMED, `${label} must be a non-empty string of at most 128 characters.`);
  }
}

export function createBusMessage(input: CreateBusMessageInput): BusMessage {
  assertAgentName("fromAgent", input.fromAgent);
  assertAgentName("toAgent", input.toAgent);
  if (!BUS_KIND_SET.has(input.kind)) {
    throw new BusError(BUS_CODES.MALFORMED, `kind must be one of: ${BUS_MESSAGE_KINDS.join(", ")}.`);
  }
  const core: BusMessageCore = {
    schema: BUS_MESSAGE_SCHEMA,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    kind: input.kind,
    body: input.body ?? null,
    ref: input.ref ?? null,
  };
  const ts = input.ts ?? Date.now();
  if (!Number.isSafeInteger(ts) || ts < 0) {
    throw new BusError(BUS_CODES.MALFORMED, "ts must be a non-negative safe integer (unix milliseconds).");
  }
  return { ...core, id: busMessageId(core), ts, signer: null, sig: "" };
}

/**
 * Structural validation plus the integrity check: the id must equal
 * the content hash of the core. Throws `BusError` (`bus_malformed` /
 * `bus_id_mismatch`). This proves the message is internally
 * consistent; it proves nothing about who sent it — see
 * `verifyBusMessage`.
 */
export function validateBusMessage(value: unknown): BusMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BusError(BUS_CODES.MALFORMED, "bus message must be a JSON object.");
  }
  const message = value as Record<string, unknown>;
  if (message.schema !== BUS_MESSAGE_SCHEMA) {
    throw new BusError(BUS_CODES.MALFORMED, `bus message schema must be ${BUS_MESSAGE_SCHEMA}.`);
  }
  assertAgentName("fromAgent", message.fromAgent);
  assertAgentName("toAgent", message.toAgent);
  if (typeof message.kind !== "string" || !BUS_KIND_SET.has(message.kind)) {
    throw new BusError(BUS_CODES.MALFORMED, `kind must be one of: ${BUS_MESSAGE_KINDS.join(", ")}.`);
  }
  if (!Number.isSafeInteger(message.ts) || (message.ts as number) < 0) {
    throw new BusError(BUS_CODES.MALFORMED, "ts must be a non-negative safe integer (unix milliseconds).");
  }
  if (message.ref !== null && typeof message.ref !== "string") {
    throw new BusError(BUS_CODES.MALFORMED, "ref must be a string or null.");
  }
  if (message.signer !== null && typeof message.signer !== "string") {
    throw new BusError(BUS_CODES.MALFORMED, "signer must be a string or null.");
  }
  if (typeof message.sig !== "string") {
    throw new BusError(BUS_CODES.MALFORMED, "sig must be a string (base64 signature, or empty when unsigned).");
  }
  if (typeof message.id !== "string" || !/^sch_[a-f0-9]{64}$/.test(message.id)) {
    throw new BusError(BUS_CODES.MALFORMED, "id must be a sch_<sha256> content hash.");
  }
  const core: BusMessageCore = {
    schema: BUS_MESSAGE_SCHEMA,
    fromAgent: message.fromAgent,
    toAgent: message.toAgent,
    kind: message.kind as BusMessageKind,
    body: message.body ?? null,
    ref: (message.ref as string | null) ?? null,
  };
  if (busMessageId(core) !== message.id) {
    throw new BusError(BUS_CODES.ID_MISMATCH, "bus message id does not match the content hash of its core.");
  }
  return {
    ...core,
    id: message.id,
    ts: message.ts as number,
    signer: (message.signer as string | null) ?? null,
    sig: message.sig,
  };
}

/**
 * The one canonical byte record a bus signature covers, in the style
 * of Phase 4's `gate_canonical_payload`: a version header line, then
 * `key:value` lines, then a trailing newline. Signer and verifier
 * share this single implementation so they cannot drift.
 */
export function busCanonicalPayload(message: BusMessage): string {
  const bodySha256 = message.body === null ? "-" : sha256Hex(canonicalBusJson(message.body));
  return [
    BUS_SIGNATURE_VERSION,
    `id:${message.id}`,
    `from:${message.fromAgent}`,
    `to:${message.toAgent}`,
    `kind:${message.kind}`,
    `ts:${message.ts}`,
    `body-sha256:${bodySha256}`,
    `ref:${message.ref ?? "-"}`,
    `signer:${message.signer ?? "-"}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 4 key world: `solvelang.key-registry` v1 public registry and
// `solvelang.private-key` v1 signer files, Ed25519 throughout. The
// registry's `public_key` is the base64 of the raw 32-byte verifying
// key and the private file's `private_key` is the base64 of the raw
// 32-byte seed — byte-identical to what `solvec keygen` writes, so a
// keypair made for signed gates signs bus messages unchanged.
// ---------------------------------------------------------------------------

const ED25519_PKCS8_DER_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64Bytes(label: string, value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new BusError(BUS_CODES.MALFORMED, `${label} must be a non-empty base64 string.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new BusError(BUS_CODES.MALFORMED, `${label} is not canonical base64.`);
  }
  return bytes;
}

export function privateKeyObjectFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) {
    throw new BusError(BUS_CODES.MALFORMED, "Ed25519 private key seed must decode to exactly 32 bytes.");
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_DER_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function publicKeyObjectFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) {
    throw new BusError(BUS_CODES.MALFORMED, "Ed25519 public key must decode to exactly 32 bytes.");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function rawPublicKeyBytes(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: unknown };
  if (typeof jwk.x !== "string") {
    throw new BusError(BUS_CODES.MALFORMED, "key is not an Ed25519 public key.");
  }
  return Buffer.from(jwk.x, "base64url");
}

export interface BusRegisteredKey {
  id: string;
  /** Raw 32-byte Ed25519 verifying key. */
  publicKey: Buffer;
  status: "active" | "revoked";
}

export class BusKeyRegistry {
  readonly #keys = new Map<string, BusRegisteredKey>();

  constructor(entries: readonly BusRegisteredKey[]) {
    for (const entry of entries) {
      if (this.#keys.has(entry.id)) {
        throw new BusError(BUS_CODES.MALFORMED, `key registry contains duplicate key id ${JSON.stringify(entry.id)}.`);
      }
      this.#keys.set(entry.id, entry);
    }
  }

  /** Parse a `solvelang.key-registry` v1 document (the Phase 4 format). */
  static fromJson(value: unknown): BusKeyRegistry {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BusError(BUS_CODES.MALFORMED, "key registry must be a JSON object.");
    }
    const registry = value as Record<string, unknown>;
    if (registry.format !== BUS_KEY_REGISTRY_FORMAT || registry.version !== BUS_KEY_REGISTRY_VERSION) {
      throw new BusError(
        BUS_CODES.MALFORMED,
        `key registry must be format ${BUS_KEY_REGISTRY_FORMAT} version ${BUS_KEY_REGISTRY_VERSION}.`,
      );
    }
    if (!Array.isArray(registry.keys)) {
      throw new BusError(BUS_CODES.MALFORMED, "key registry keys must be an array.");
    }
    const entries = registry.keys.map((raw, index) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new BusError(BUS_CODES.MALFORMED, `key registry keys[${index}] must be an object.`);
      }
      const entry = raw as Record<string, unknown>;
      if (typeof entry.id !== "string" || entry.id.length === 0) {
        throw new BusError(BUS_CODES.MALFORMED, `key registry keys[${index}].id must be a non-empty string.`);
      }
      if (entry.algorithm !== BUS_ALGORITHM_ED25519) {
        throw new BusError(BUS_CODES.MALFORMED, `key registry keys[${index}].algorithm must be ed25519.`);
      }
      const publicKey = base64Bytes(`key registry keys[${index}].public_key`, entry.public_key);
      if (publicKey.length !== 32) {
        throw new BusError(BUS_CODES.MALFORMED, `key registry keys[${index}].public_key must decode to 32 bytes.`);
      }
      if (entry.status !== "active" && entry.status !== "revoked") {
        throw new BusError(BUS_CODES.MALFORMED, `key registry keys[${index}].status must be active or revoked.`);
      }
      return { id: entry.id, publicKey, status: entry.status } satisfies BusRegisteredKey;
    });
    return new BusKeyRegistry(entries);
  }

  static fromText(text: string): BusKeyRegistry {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new BusError(BUS_CODES.MALFORMED, "key registry is not valid JSON.");
    }
    return BusKeyRegistry.fromJson(value);
  }

  get(id: string): BusRegisteredKey | undefined {
    return this.#keys.get(id);
  }

  ids(): string[] {
    return [...this.#keys.keys()];
  }
}

export interface BusPrivateKey {
  id: string;
  key: KeyObject;
  /** Raw 32-byte Ed25519 verifying key matching the registry entry. */
  publicKey: Buffer;
}

/** Parse a `solvelang.private-key` v1 artifact (the Phase 4 format). */
export function parsePrivateKeyJson(value: unknown): BusPrivateKey {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BusError(BUS_CODES.MALFORMED, "private key artifact must be a JSON object.");
  }
  const artifact = value as Record<string, unknown>;
  if (artifact.format !== BUS_PRIVATE_KEY_FORMAT || artifact.version !== BUS_PRIVATE_KEY_VERSION) {
    throw new BusError(
      BUS_CODES.MALFORMED,
      `private key artifact must be format ${BUS_PRIVATE_KEY_FORMAT} version ${BUS_PRIVATE_KEY_VERSION}.`,
    );
  }
  if (typeof artifact.id !== "string" || artifact.id.length === 0) {
    throw new BusError(BUS_CODES.MALFORMED, "private key artifact id must be a non-empty string.");
  }
  if (artifact.algorithm !== BUS_ALGORITHM_ED25519) {
    throw new BusError(BUS_CODES.MALFORMED, "private key artifact algorithm must be ed25519.");
  }
  const seed = base64Bytes("private key artifact private_key", artifact.private_key);
  const key = privateKeyObjectFromSeed(seed);
  return { id: artifact.id, key, publicKey: rawPublicKeyBytes(createPublicKey(key)) };
}

export function parsePrivateKeyText(text: string): BusPrivateKey {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BusError(BUS_CODES.MALFORMED, "private key artifact is not valid JSON.");
  }
  return parsePrivateKeyJson(value);
}

/** Sign an arbitrary canonical payload; returns the base64 signature. */
export function signBusPayload(payload: string, key: KeyObject): string {
  return nodeSign(null, Buffer.from(payload, "utf8"), key).toString("base64");
}

/** Verify a base64 signature over a canonical payload against a raw public key. */
export function verifyBusPayload(payload: string, signatureBase64: string, publicKeyRaw: Buffer): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    return nodeVerify(null, Buffer.from(payload, "utf8"), publicKeyObjectFromRaw(publicKeyRaw), signature);
  } catch {
    return false;
  }
}

/**
 * Return a copy of the message signed with the given Phase 4 private
 * key: `signer` is set to the key id and `sig` covers the canonical
 * payload (which itself names the signer, so a signature cannot be
 * transplanted onto another signer's record).
 */
export function signBusMessage(message: BusMessage, privateKey: BusPrivateKey): BusMessage {
  const signed: BusMessage = { ...message, signer: privateKey.id, sig: "" };
  signed.sig = signBusPayload(busCanonicalPayload(signed), privateKey.key);
  return signed;
}

export type BusVerification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: string; message: string }>;

function refuse(code: string, message: string): BusVerification {
  return { ok: false, code, message };
}

/**
 * Verify a message's authenticity against the registry, fail-closed,
 * with distinct refusal codes in Phase 4's style. Check order:
 * signature presence → signer known → signer not revoked → signature
 * verifies. Integrity (id vs core) is `validateBusMessage`'s job and
 * should be checked first.
 */
export function verifyBusMessage(message: BusMessage, registry: BusKeyRegistry): BusVerification {
  if (!message.signer || !message.sig) {
    return refuse(BUS_CODES.UNSIGNED, "bus message carries no signature; registry mode requires one.");
  }
  const entry = registry.get(message.signer);
  if (!entry) {
    return refuse(BUS_CODES.UNKNOWN_SIGNER, `bus signer ${JSON.stringify(message.signer)} is not in the key registry.`);
  }
  if (entry.status === "revoked") {
    return refuse(BUS_CODES.SIGNER_REVOKED, `bus signer ${JSON.stringify(message.signer)} is revoked in the key registry.`);
  }
  if (!verifyBusPayload(busCanonicalPayload(message), message.sig, entry.publicKey)) {
    return refuse(BUS_CODES.SIGNATURE_INVALID, "bus message signature does not verify over the canonical payload.");
  }
  return { ok: true };
}

/**
 * Idempotent consumer helper (design §3.3): at-least-once delivery
 * collapses by content-hash id. Bounded: the oldest ids are evicted
 * past the cap so a long-lived consumer does not grow without limit.
 */
export class BusDedup {
  readonly #seen = new Set<string>();
  readonly #cap: number;

  constructor(cap = 10_000) {
    this.#cap = Math.max(16, cap);
  }

  /** True the first time an id is presented, false for duplicates. */
  accept(message: BusMessage): boolean {
    if (this.#seen.has(message.id)) return false;
    this.#seen.add(message.id);
    if (this.#seen.size > this.#cap) {
      const oldest = this.#seen.values().next().value as string;
      this.#seen.delete(oldest);
    }
    return true;
  }

  has(id: string): boolean {
    return this.#seen.has(id);
  }
}
