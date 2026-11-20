import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import { createWriteStream, readFileSync, type WriteStream } from "node:fs";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createRemoteRateLimiter, type RemoteRateLimit } from "./remote.js";

// SolveLang hosted relay — the cross-machine counterpart of the Phase 6
// local bus daemon (design doc §3.2 Option B; spike verdict: adopt on the
// conflicts leg). The relay carries SIGNALS ONLY: the durable record is
// still the content-addressed handoff document a message points at via
// `ref`. Documents carry truth; the bus carries signals.
//
// Protocol identity with the local daemon is deliberate: the envelope is
// the handoff schema extended (design §3.1) with the same content-hash id,
// the same kinds, and the same claim semantics (atomic grant/deny at claim
// time, TTL leases, expiry frees the item and is logged + signalled).
// The one protocol change the hosted hop requires is authenticity: the
// envelope's reserved `sig` field now carries a Phase 4-style Ed25519
// signature, and a message that fails authenticity is REFUSED, never
// relayed (see verifyRelayEnvelopeSignature).
//
// State is held per workspace in memory: signals are ephemeral by design,
// so a relay restart loses undelivered signals but no truth (the audit
// log is the durable record of what was relayed). Workspaces are fully
// isolated: a bearer token binds exactly one (workspace, agent) pair and
// no route can observe another workspace's messages, claims, or presence.

export const RELAY_HEALTH_PATH = "/healthz" as const;
export const RELAY_MESSAGES_PATH = "/relay/messages" as const;
export const RELAY_CLAIMS_PATH = "/relay/claims" as const;
export const RELAY_CLAIM_RELEASE_PATH = "/relay/claims/release" as const;
export const RELAY_PRESENCE_PATH = "/relay/presence" as const;
export const RELAY_MAX_REQUEST_BYTES = 256 * 1024;
export const RELAY_DEFAULT_PORT = 8788;
export const RELAY_DEFAULT_CLAIM_TTL_MS = 8_000;
export const RELAY_MIN_CLAIM_TTL_MS = 250;
export const RELAY_MAX_CLAIM_TTL_MS = 300_000;
export const RELAY_MAX_LONG_POLL_MS = 30_000;
export const RELAY_RETAINED_MESSAGES_PER_WORKSPACE = 1_000;
export const RELAY_SIGNATURE_SCHEME = "solvelang-bus-signature-v1" as const;

export const relayMessageKinds = Object.freeze([
  "signal",
  "claim",
  "release",
  "propose",
  "accept",
  "reject",
  "ping",
  "pong",
] as const);
export type RelayMessageKind = (typeof relayMessageKinds)[number];

export type RelayEnvelope = Readonly<{
  id: string;
  fromAgent: string;
  toAgent: string;
  kind: RelayMessageKind;
  body: unknown;
  ref: string | null;
  ts: number;
  sig: string;
}>;

// Canonical JSON identical to the spike envelope's canonicalization
// (sorted keys, recursive): the content-hash id must agree byte-for-byte
// with the local bus for the same logical message.
export function relayCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    return primitive === undefined ? "null" : primitive;
  }
  if (Array.isArray(value)) return "[" + value.map((entry) => relayCanonicalJson(entry)).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + relayCanonicalJson(record[key])).join(",") + "}";
}

export function computeRelayEnvelopeId(core: Readonly<{
  fromAgent: string;
  toAgent: string;
  kind: RelayMessageKind;
  body?: unknown;
  ref?: string | null;
}>): string {
  const normalized = {
    fromAgent: core.fromAgent,
    toAgent: core.toAgent,
    kind: core.kind,
    body: core.body ?? null,
    ref: core.ref ?? null,
  };
  return "sch_" + createHash("sha256").update(relayCanonicalJson(normalized), "utf8").digest("hex");
}

export function createRelayEnvelope(input: Readonly<{
  fromAgent: string;
  toAgent: string;
  kind: RelayMessageKind;
  body?: unknown;
  ref?: string | null;
  ts?: number;
  sig?: string;
}>): RelayEnvelope {
  const body = input.body ?? null;
  const ref = input.ref ?? null;
  return {
    id: computeRelayEnvelopeId({ fromAgent: input.fromAgent, toAgent: input.toAgent, kind: input.kind, body, ref }),
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    kind: input.kind,
    body,
    ref,
    ts: input.ts ?? Date.now(),
    sig: input.sig ?? "",
  };
}

// The canonical bytes a signer signs, in the Phase 4 gate-payload style
// (version line, then one `field:value` line each, trailing newline).
// The envelope id already binds from/to/kind/body/ref by content hash;
// naming the fields beside it keeps the signed statement human-auditable.
export function relaySignaturePayload(envelope: RelayEnvelope, signerKeyId: string): string {
  return [
    RELAY_SIGNATURE_SCHEME,
    `id:${envelope.id}`,
    `from:${envelope.fromAgent}`,
    `to:${envelope.toAgent}`,
    `kind:${envelope.kind}`,
    `signer:${signerKeyId}`,
  ].join("\n") + "\n";
}

export type RelayKeyEntry = Readonly<{
  id: string;
  algorithm: "ed25519";
  public_key: string;
  status: "active" | "revoked";
}>;

export type RelaySignatureVerdict =
  | Readonly<{ ok: true; signer: string }>
  | Readonly<{ ok: false; code: "signature_required" | "signature_malformed" | "unknown_signer" | "signer_revoked" | "signature_invalid" }>;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function parseRelaySignature(sig: string): Readonly<{ keyId: string; signature: Buffer }> | null {
  const match = /^ed25519:([A-Za-z0-9._-]{1,64}):([A-Za-z0-9+/]+={0,2})$/.exec(sig);
  if (!match) return null;
  const signature = Buffer.from(match[2]!, "base64");
  if (signature.length !== 64) return null;
  return { keyId: match[1]!, signature };
}

export function verifyRelayEnvelopeSignature(
  envelope: RelayEnvelope,
  keys: readonly RelayKeyEntry[],
): RelaySignatureVerdict {
  if (envelope.sig === "") return { ok: false, code: "signature_required" };
  const parsed = parseRelaySignature(envelope.sig);
  if (!parsed) return { ok: false, code: "signature_malformed" };
  const entry = keys.find((key) => key.id === parsed.keyId);
  if (!entry || entry.algorithm !== "ed25519") return { ok: false, code: "unknown_signer" };
  if (entry.status === "revoked") return { ok: false, code: "signer_revoked" };
  const rawPublicKey = Buffer.from(entry.public_key, "base64");
  if (rawPublicKey.length !== 32) return { ok: false, code: "unknown_signer" };
  let valid = false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    });
    valid = cryptoVerify(null, Buffer.from(relaySignaturePayload(envelope, parsed.keyId), "utf8"), publicKey, parsed.signature);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, signer: parsed.keyId } : { ok: false, code: "signature_invalid" };
}

// ---------------------------------------------------------------------------
// Configuration. The relay's config is a host-held JSON file (never in
// git): token values exist only as SHA-256 hashes here, and workspace key
// registries carry public keys only — the Phase 4 registry shape.
// ---------------------------------------------------------------------------

export type RelayTokenBinding = Readonly<{ agent: string; tokenSha256: string }>;

export type RelayWorkspaceConfig = Readonly<{
  id: string;
  requireSignatures: boolean;
  keys: readonly RelayKeyEntry[];
  tokens: readonly RelayTokenBinding[];
}>;

export type RelayConfig = Readonly<{ workspaces: readonly RelayWorkspaceConfig[] }>;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function relayTokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeRelayConfig(value: unknown): RelayConfig {
  if (!isRecord(value) || !Array.isArray(value.workspaces) || value.workspaces.length === 0) {
    throw new Error("Relay config must be an object with a non-empty workspaces array.");
  }
  const workspaceIds = new Set<string>();
  const tokenOwners = new Map<string, string>();
  const workspaces = value.workspaces.map((rawWorkspace, index) => {
    if (!isRecord(rawWorkspace)) throw new Error(`Relay workspace #${index} must be an object.`);
    const id = rawWorkspace.id;
    if (typeof id !== "string" || !SAFE_NAME.test(id)) throw new Error(`Relay workspace #${index} has an invalid id.`);
    if (workspaceIds.has(id)) throw new Error(`Relay workspace id ${id} is duplicated.`);
    workspaceIds.add(id);
    const requireSignatures = rawWorkspace.requireSignatures === undefined ? true : rawWorkspace.requireSignatures;
    if (typeof requireSignatures !== "boolean") throw new Error(`Relay workspace ${id}: requireSignatures must be a boolean.`);
    const rawKeys = rawWorkspace.keys === undefined ? [] : rawWorkspace.keys;
    if (!Array.isArray(rawKeys)) throw new Error(`Relay workspace ${id}: keys must be an array.`);
    const keyIds = new Set<string>();
    const keys = rawKeys.map((rawKey) => {
      if (!isRecord(rawKey)) throw new Error(`Relay workspace ${id}: each key must be an object.`);
      const keyId = rawKey.id;
      if (typeof keyId !== "string" || !SAFE_NAME.test(keyId)) throw new Error(`Relay workspace ${id}: a key has an invalid id.`);
      if (keyIds.has(keyId)) throw new Error(`Relay workspace ${id}: key id ${keyId} is duplicated.`);
      keyIds.add(keyId);
      if (rawKey.algorithm !== "ed25519") throw new Error(`Relay workspace ${id}: key ${keyId} must use algorithm ed25519.`);
      if (typeof rawKey.public_key !== "string" || Buffer.from(rawKey.public_key, "base64").length !== 32) {
        throw new Error(`Relay workspace ${id}: key ${keyId} public_key must be base64 for a 32-byte Ed25519 key.`);
      }
      if (rawKey.status !== "active" && rawKey.status !== "revoked") {
        throw new Error(`Relay workspace ${id}: key ${keyId} status must be active or revoked.`);
      }
      const status: "active" | "revoked" = rawKey.status;
      return { id: keyId, algorithm: "ed25519" as const, public_key: rawKey.public_key as string, status };
    });
    if (requireSignatures && keys.length === 0) {
      throw new Error(`Relay workspace ${id}: requireSignatures is true but no signer keys are registered.`);
    }
    const rawTokens = rawWorkspace.tokens;
    if (!Array.isArray(rawTokens) || rawTokens.length === 0) throw new Error(`Relay workspace ${id}: tokens must be a non-empty array.`);
    const agents = new Set<string>();
    const tokens = rawTokens.map((rawToken) => {
      if (!isRecord(rawToken)) throw new Error(`Relay workspace ${id}: each token binding must be an object.`);
      const agent = rawToken.agent;
      if (typeof agent !== "string" || !SAFE_NAME.test(agent)) throw new Error(`Relay workspace ${id}: a token binding has an invalid agent.`);
      if (agents.has(agent)) throw new Error(`Relay workspace ${id}: agent ${agent} has more than one token binding.`);
      agents.add(agent);
      const tokenSha256 = rawToken.tokenSha256;
      if (typeof tokenSha256 !== "string" || !/^[a-f0-9]{64}$/.test(tokenSha256)) {
        throw new Error(`Relay workspace ${id}: token for agent ${agent} must carry a lowercase sha256 hex tokenSha256.`);
      }
      const owner = `${id}/${agent}`;
      const previous = tokenOwners.get(tokenSha256);
      if (previous) throw new Error(`Relay token hash is bound to both ${previous} and ${owner}; a token must bind exactly one agent.`);
      tokenOwners.set(tokenSha256, owner);
      return { agent, tokenSha256 };
    });
    return { id, requireSignatures, keys, tokens };
  });
  return { workspaces };
}

export function loadRelayConfigFile(path: string): RelayConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Relay config at ${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeRelayConfig(parsed);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

type StoredMessage = Readonly<{ seq: number; envelope: RelayEnvelope; receivedAt: number }>;
type Claim = { holder: string; expiresAt: number };

class WorkspaceState {
  seq = 0;
  readonly messages: StoredMessage[] = [];
  readonly claims = new Map<string, Claim>();
  readonly presence = new Map<string, number>();
  readonly waiters = new Set<() => void>();

  append(envelope: RelayEnvelope, receivedAt: number): StoredMessage {
    this.seq += 1;
    const stored = { seq: this.seq, envelope, receivedAt };
    this.messages.push(stored);
    if (this.messages.length > RELAY_RETAINED_MESSAGES_PER_WORKSPACE) {
      this.messages.splice(0, this.messages.length - RELAY_RETAINED_MESSAGES_PER_WORKSPACE);
    }
    for (const wake of [...this.waiters]) wake();
    return stored;
  }
}

export type RelayAuditEntry = Readonly<Record<string, unknown>>;

export type RelayHttpServerOptions = Readonly<{
  config: RelayConfig;
  rateLimit?: Partial<RemoteRateLimit> | false;
  trustProxy?: boolean;
  audit?: (entry: RelayAuditEntry) => void;
  now?: () => number;
}>;

function sendJson(res: ServerResponse, statusCode: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify(value));
}

async function readBoundedJsonRequest(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw Object.assign(new Error("Relay requests require application/json."), { statusCode: 415 });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > RELAY_MAX_REQUEST_BYTES) throw Object.assign(new Error("Relay request exceeds the bounded request size."), { statusCode: 413 });
    chunks.push(bytes);
  }
  if (total === 0) throw Object.assign(new Error("Relay request body is required."), { statusCode: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Relay request body must be valid JSON."), { statusCode: 400 });
  }
}

function readBoundedBodyErrorStatus(error: unknown): number {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 400;
  return Number.isInteger(statusCode) ? statusCode : 400;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function normalizeIncomingEnvelope(value: unknown): RelayEnvelope | null {
  if (!isRecord(value)) return null;
  const { id, fromAgent, toAgent, kind, ts, sig } = value;
  if (typeof id !== "string" || !/^sch_[a-f0-9]{64}$/.test(id)) return null;
  if (typeof fromAgent !== "string" || fromAgent.length === 0 || fromAgent.length > 128 || CONTROL_CHARS.test(fromAgent)) return null;
  if (typeof toAgent !== "string" || toAgent.length === 0 || toAgent.length > 128 || CONTROL_CHARS.test(toAgent)) return null;
  if (typeof kind !== "string" || !(relayMessageKinds as readonly string[]).includes(kind)) return null;
  if (typeof ts !== "number" || !Number.isSafeInteger(ts) || ts <= 0) return null;
  if (typeof sig !== "string" || sig.length > 4096) return null;
  const ref = value.ref === undefined ? null : value.ref;
  if (ref !== null && (typeof ref !== "string" || ref.length > 2048)) return null;
  return {
    id,
    fromAgent,
    toAgent,
    kind: kind as RelayMessageKind,
    body: value.body ?? null,
    ref,
    ts,
    sig,
  };
}

export function createRelayHttpServer(options: RelayHttpServerOptions): HttpServer {
  const config = options.config;
  const now = options.now ?? Date.now;
  const audit = options.audit ?? (() => undefined);
  const rateLimit: RemoteRateLimit | null = options.rateLimit === false
    ? null
    : { limit: options.rateLimit?.limit ?? 300, windowMs: options.rateLimit?.windowMs ?? 60_000 };
  const rateLimiter = rateLimit ? createRemoteRateLimiter(rateLimit, now) : null;
  const states = new Map<string, WorkspaceState>();
  const stateFor = (workspaceId: string): WorkspaceState => {
    let state = states.get(workspaceId);
    if (!state) {
      state = new WorkspaceState();
      states.set(workspaceId, state);
    }
    return state;
  };

  const authenticate = (req: IncomingMessage): { workspace: RelayWorkspaceConfig; agent: string } | null => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    const supplied = header.slice("Bearer ".length).trim();
    if (supplied.length === 0 || supplied.length > 1024) return null;
    const suppliedHash = createHash("sha256").update(supplied, "utf8").digest();
    for (const workspace of config.workspaces) {
      for (const binding of workspace.tokens) {
        const expected = Buffer.from(binding.tokenSha256, "hex");
        if (expected.length === suppliedHash.length && timingSafeEqual(expected, suppliedHash)) {
          return { workspace, agent: binding.agent };
        }
      }
    }
    return null;
  };

  const sourceOf = (req: IncomingMessage): string | undefined => {
    if (options.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",", 1)[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress;
  };

  const injectSystemSignal = (state: WorkspaceState, signal: string, item: string): void => {
    const at = now();
    const envelope: RelayEnvelope = {
      id: `sys-${signal}-${item}-${at}-${state.seq + 1}`,
      fromAgent: "relay",
      toAgent: "*",
      kind: "signal",
      body: { signal, item },
      ref: null,
      ts: at,
      sig: "",
    };
    state.append(envelope, at);
  };

  const sweepExpired = (workspace: RelayWorkspaceConfig, state: WorkspaceState): void => {
    const at = now();
    for (const [item, claim] of [...state.claims]) {
      if (claim.expiresAt <= at) {
        state.claims.delete(item);
        audit({ t: at, event: "claim_expired", workspace: workspace.id, item, holder: claim.holder });
        injectSystemSignal(state, "claim_expired", item);
      }
    }
  };

  const server = createNodeHttpServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://solvelang.invalid");
      const pathname = url.pathname;
      if (pathname === RELAY_HEALTH_PATH && req.method === "GET") {
        sendJson(res, 200, { status: "ok", service: "solvelang-relay", mode: "hosted-relay" });
        return;
      }
      const knownPaths: readonly string[] = [RELAY_MESSAGES_PATH, RELAY_CLAIMS_PATH, RELAY_CLAIM_RELEASE_PATH, RELAY_PRESENCE_PATH];
      if (!knownPaths.includes(pathname)) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      if (rateLimiter) {
        const verdict = rateLimiter.check(sourceOf(req));
        if (!verdict.allowed) {
          sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(verdict.retryAfterSeconds) });
          return;
        }
      }
      const auth = authenticate(req);
      if (!auth) {
        sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
        return;
      }
      const { workspace, agent } = auth;
      const state = stateFor(workspace.id);
      state.presence.set(agent, now());

      if (pathname === RELAY_MESSAGES_PATH && req.method === "POST") {
        let body: unknown;
        try {
          body = await readBoundedJsonRequest(req);
        } catch (error) {
          sendJson(res, readBoundedBodyErrorStatus(error), { error: "invalid_request" });
          return;
        }
        const envelope = normalizeIncomingEnvelope(body);
        if (!envelope) {
          audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: "invalid_envelope" });
          sendJson(res, 400, { error: "invalid_envelope" });
          return;
        }
        if (envelope.fromAgent !== agent) {
          audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: "sender_mismatch", id: envelope.id });
          sendJson(res, 403, { error: "sender_mismatch" });
          return;
        }
        const expectedId = computeRelayEnvelopeId(envelope);
        if (expectedId !== envelope.id) {
          audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: "id_mismatch", id: envelope.id });
          sendJson(res, 400, { error: "id_mismatch" });
          return;
        }
        // Authenticity gate: a workspace that requires signatures refuses
        // unsigned or invalidly signed messages outright, and a presented
        // signature that fails verification is refused in EVERY workspace —
        // a bad signature is never relayed on the theory that it was
        // optional. Refusals are audited and nothing is delivered.
        if (workspace.requireSignatures || envelope.sig !== "") {
          const verdict = verifyRelayEnvelopeSignature(envelope, workspace.keys);
          if (!verdict.ok) {
            audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: verdict.code, id: envelope.id });
            sendJson(res, 403, { error: verdict.code });
            return;
          }
        }
        const existing = state.messages.find((stored) => stored.envelope.id === envelope.id);
        if (existing) {
          sendJson(res, 200, { ok: true, id: envelope.id, seq: existing.seq, duplicate: true });
          return;
        }
        const stored = state.append(envelope, now());
        audit({ t: now(), event: "message", workspace: workspace.id, agent, id: envelope.id, kind: envelope.kind, toAgent: envelope.toAgent, seq: stored.seq });
        sendJson(res, 200, { ok: true, id: envelope.id, seq: stored.seq });
        return;
      }

      if (pathname === RELAY_MESSAGES_PATH && req.method === "GET") {
        const sinceRaw = Number(url.searchParams.get("since") ?? "0");
        const since = Number.isSafeInteger(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
        const waitRaw = Number(url.searchParams.get("waitMs") ?? "0");
        const waitMs = Number.isSafeInteger(waitRaw) ? Math.min(Math.max(waitRaw, 0), RELAY_MAX_LONG_POLL_MS) : 0;
        const collect = (): StoredMessage[] => state.messages.filter(
          (stored) => stored.seq > since && (stored.envelope.toAgent === agent || stored.envelope.toAgent === "*"),
        );
        let messages = collect();
        if (messages.length === 0 && waitMs > 0) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              state.waiters.delete(finish);
              resolve();
            };
            state.waiters.add(finish);
            setTimeout(finish, waitMs).unref();
            res.on("close", finish);
          });
          messages = collect();
        }
        sendJson(res, 200, {
          messages: messages.map((stored) => stored.envelope),
          next: messages.length > 0 ? messages[messages.length - 1]!.seq : since,
        });
        return;
      }

      if (pathname === RELAY_CLAIMS_PATH && req.method === "POST") {
        let body: unknown;
        try {
          body = await readBoundedJsonRequest(req);
        } catch (error) {
          sendJson(res, readBoundedBodyErrorStatus(error), { error: "invalid_request" });
          return;
        }
        if (!isRecord(body) || typeof body.item !== "string" || body.item.length === 0 || body.item.length > 512 || CONTROL_CHARS.test(body.item)) {
          sendJson(res, 400, { error: "invalid_claim" });
          return;
        }
        const ttlRaw = body.ttlMs === undefined ? RELAY_DEFAULT_CLAIM_TTL_MS : Number(body.ttlMs);
        if (!Number.isSafeInteger(ttlRaw) || ttlRaw < RELAY_MIN_CLAIM_TTL_MS || ttlRaw > RELAY_MAX_CLAIM_TTL_MS) {
          sendJson(res, 400, { error: "invalid_claim_ttl" });
          return;
        }
        sweepExpired(workspace, state);
        const item = body.item;
        const current = state.claims.get(item);
        if (!current || current.holder === agent) {
          const expiresAt = now() + ttlRaw;
          state.claims.set(item, { holder: agent, expiresAt });
          audit({ t: now(), event: "claim_granted", workspace: workspace.id, item, agent, expiresAt });
          sendJson(res, 200, { granted: true, item, holder: agent, expiresAt });
          return;
        }
        audit({ t: now(), event: "claim_denied", workspace: workspace.id, item, agent, holder: current.holder });
        sendJson(res, 200, { granted: false, item, holder: current.holder, expiresAt: current.expiresAt });
        return;
      }

      if (pathname === RELAY_CLAIM_RELEASE_PATH && req.method === "POST") {
        let body: unknown;
        try {
          body = await readBoundedJsonRequest(req);
        } catch (error) {
          sendJson(res, readBoundedBodyErrorStatus(error), { error: "invalid_request" });
          return;
        }
        if (!isRecord(body) || typeof body.item !== "string" || body.item.length === 0 || body.item.length > 512) {
          sendJson(res, 400, { error: "invalid_claim" });
          return;
        }
        sweepExpired(workspace, state);
        const item = body.item;
        const current = state.claims.get(item);
        if (current && current.holder === agent) {
          state.claims.delete(item);
          audit({ t: now(), event: "claim_released", workspace: workspace.id, item, agent });
          injectSystemSignal(state, "claim_released", item);
          sendJson(res, 200, { released: true, item });
          return;
        }
        sendJson(res, 200, { released: false, item, holder: current?.holder ?? null });
        return;
      }

      if (pathname === RELAY_CLAIMS_PATH && req.method === "GET") {
        sweepExpired(workspace, state);
        const claims = [...state.claims.entries()].map(([item, claim]) => ({ item, holder: claim.holder, expiresAt: claim.expiresAt }));
        sendJson(res, 200, { claims });
        return;
      }

      if (pathname === RELAY_PRESENCE_PATH && req.method === "GET") {
        const target = url.searchParams.get("agent") ?? agent;
        const lastSeen = state.presence.get(target) ?? null;
        sendJson(res, 200, { agent: target, lastSeen, silentMs: lastSeen === null ? null : Math.max(0, now() - lastSeen) });
        return;
      }

      if (pathname === RELAY_PRESENCE_PATH && req.method === "POST") {
        sendJson(res, 200, { ok: true, agent, lastSeen: state.presence.get(agent) ?? now() });
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      else if (!res.writableEnded) res.end();
    });
  });

  const sweepTimer = setInterval(() => {
    for (const workspace of config.workspaces) {
      const state = states.get(workspace.id);
      if (state) sweepExpired(workspace, state);
    }
  }, 250);
  sweepTimer.unref();
  server.on("close", () => clearInterval(sweepTimer));
  return server;
}

export type StartRelayServerOptions = Readonly<{
  config?: RelayConfig;
  configPath?: string;
  host?: string;
  port?: number;
  rateLimit?: Partial<RemoteRateLimit> | false;
  trustProxy?: boolean;
  auditLogPath?: string;
}>;

export async function startRelayServer(options: StartRelayServerOptions = {}): Promise<HttpServer> {
  const config = options.config ?? loadRelayConfigFile(
    options.configPath ?? process.env.SOLVELANG_RELAY_CONFIG ?? "",
  );
  const host = options.host ?? process.env.SOLVELANG_RELAY_HOST ?? "127.0.0.1";
  const configuredPort = options.port ?? Number(process.env.PORT ?? process.env.SOLVELANG_RELAY_PORT ?? String(RELAY_DEFAULT_PORT));
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
    throw new Error("Relay port must be an integer from 0 through 65535.");
  }
  const trustProxy = options.trustProxy ?? (process.env.SOLVELANG_RELAY_TRUST_PROXY === "1");
  let auditStream: WriteStream | undefined;
  const auditLogPath = options.auditLogPath ?? process.env.SOLVELANG_RELAY_AUDIT_LOG;
  if (auditLogPath) {
    auditStream = createWriteStream(auditLogPath, { flags: "a" });
  }
  const audit = auditStream
    ? (entry: RelayAuditEntry) => { auditStream!.write(JSON.stringify(entry) + "\n"); }
    : undefined;
  const server = createRelayHttpServer({ config, rateLimit: options.rateLimit, trustProxy, audit });
  server.on("close", () => { if (auditStream) auditStream.end(); });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(configuredPort, host);
  });
  return server;
}
