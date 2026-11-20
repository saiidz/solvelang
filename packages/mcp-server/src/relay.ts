import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream, readFileSync, type WriteStream } from "node:fs";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import {
  BUS_CODES,
  BUS_DAEMON_AGENT,
  BusError,
  BusKeyRegistry,
  validateBusMessage,
  verifyBusMessage,
  createBusMessage,
  type BusMessage,
} from "./bus-envelope.js";
import { BUS_DEFAULT_CLAIM_TTL_MS, BUS_MAX_CLAIM_TTL_MS } from "./bus-daemon.js";
import { createRemoteRateLimiter, type RemoteRateLimit } from "./remote.js";

// SolveLang hosted relay — the cross-machine counterpart of the Phase 6
// bus daemon (design doc §3.2 Option B; spike verdict: adopt on the
// conflicts leg). The relay carries SIGNALS ONLY: the durable record is
// still the content-addressed handoff document a message points at via
// `ref`. Documents carry truth; the bus carries signals.
//
// The wire protocol is the bus protocol, unchanged: envelopes, content-
// hash ids, canonical signature payloads, refusal codes, and the key
// registry are the bus-envelope module's, shared with the local daemon
// so the two hops cannot drift. Claim semantics are the daemon's
// (atomic grant/deny at claim time, TTL leases, expiry frees the item
// and is logged + signalled, claim state recoverable from the audit
// log). What the hosted hop adds is transport and tenancy: HTTP with
// long-poll delivery instead of local sockets, and workspaces — a
// bearer token binds exactly one (workspace, agent) pair and no route
// can observe another workspace's messages, claims, or presence.
//
// Authenticity modes are the bus's: a workspace in "registry" mode
// (requireSignatures) refuses any message that is unsigned or fails
// verification against its Phase 4 key registry — refused, never
// relayed, and the refusal is audited. Claim and presence calls carry
// no envelope; they are authenticated by the bearer token itself, which
// is the agent's credential on this hop (the daemon, which has no
// per-agent credential channel, verifies a signed envelope instead).

export const RELAY_HEALTH_PATH = "/healthz" as const;
export const RELAY_MESSAGES_PATH = "/relay/messages" as const;
export const RELAY_CLAIMS_PATH = "/relay/claims" as const;
export const RELAY_CLAIM_RELEASE_PATH = "/relay/claims/release" as const;
export const RELAY_PRESENCE_PATH = "/relay/presence" as const;
export const RELAY_MAX_REQUEST_BYTES = 256 * 1024;
export const RELAY_DEFAULT_PORT = 8788;
export const RELAY_MIN_CLAIM_TTL_MS = 250;
export const RELAY_DEFAULT_CLAIM_TTL_MS = BUS_DEFAULT_CLAIM_TTL_MS;
export const RELAY_MAX_CLAIM_TTL_MS = BUS_MAX_CLAIM_TTL_MS;
export const RELAY_MAX_LONG_POLL_MS = 30_000;
export const RELAY_RETAINED_MESSAGES_PER_WORKSPACE = 1_000;

export type RelayMessage = BusMessage;

// ---------------------------------------------------------------------------
// Configuration. The relay's config is a host-held JSON file (never in
// git): token values exist only as SHA-256 hashes here, and a workspace's
// signer registry is an embedded `solvelang.key-registry` v1 document
// (public keys only), parsed by the bus module's own registry reader.
// ---------------------------------------------------------------------------

export type RelayTokenBinding = Readonly<{ agent: string; tokenSha256: string }>;

export type RelayWorkspaceConfig = Readonly<{
  id: string;
  requireSignatures: boolean;
  registry: BusKeyRegistry | null;
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
    let registry: BusKeyRegistry | null = null;
    if (rawWorkspace.registry !== undefined && rawWorkspace.registry !== null) {
      try {
        registry = BusKeyRegistry.fromJson(rawWorkspace.registry);
      } catch (error) {
        throw new Error(`Relay workspace ${id}: registry is not a valid solvelang.key-registry v1 document: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (requireSignatures && !registry) {
      throw new Error(`Relay workspace ${id}: requireSignatures is true but no key registry is configured (${BUS_CODES.UNCONFIGURED}).`);
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
    return { id, requireSignatures, registry, tokens };
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

type StoredMessage = Readonly<{ seq: number; envelope: BusMessage; receivedAt: number }>;
type Claim = { holder: string; expiresAt: number };

export type RelayRecoveredState = ReadonlyMap<string, Readonly<{
  claims: readonly (readonly [string, Claim])[];
  presence: readonly (readonly [string, number])[];
}>>;

class WorkspaceState {
  seq = 0;
  readonly messages: StoredMessage[] = [];
  readonly claims = new Map<string, Claim>();
  readonly presence = new Map<string, number>();
  readonly waiters = new Set<() => void>();

  append(envelope: BusMessage, receivedAt: number): StoredMessage {
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
  recovered?: RelayRecoveredState;
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
      const recovered = options.recovered?.get(workspaceId);
      if (recovered) {
        for (const [item, claim] of recovered.claims) {
          if (claim.expiresAt > now()) state.claims.set(item, { ...claim });
        }
        for (const [agent, lastSeen] of recovered.presence) state.presence.set(agent, lastSeen);
      }
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
    const envelope = createBusMessage({
      fromAgent: BUS_DAEMON_AGENT,
      toAgent: "*",
      kind: "signal",
      body: { signal, item },
      ts: now(),
    });
    state.append(envelope, now());
  };

  const sweepExpired = (workspace: RelayWorkspaceConfig, state: WorkspaceState): void => {
    const at = now();
    for (const [item, claim] of [...state.claims]) {
      if (claim.expiresAt <= at) {
        state.claims.delete(item);
        audit({ t: at, event: "claim_expired", workspace: workspace.id, item, agent: claim.holder });
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
        let message: BusMessage;
        try {
          message = validateBusMessage(body);
        } catch (error) {
          const code = error instanceof BusError ? error.code : BUS_CODES.MALFORMED;
          audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code });
          sendJson(res, 400, { error: code });
          return;
        }
        if (message.fromAgent !== agent) {
          audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: BUS_CODES.SENDER_MISMATCH, id: message.id });
          sendJson(res, 403, { error: BUS_CODES.SENDER_MISMATCH });
          return;
        }
        // Authenticity gate, fail-closed: registry-mode workspaces
        // verify every message; in open workspaces a message that
        // carries a signature is still verified — a presented-but-bad
        // signature is never relayed on the theory it was optional.
        const carriesSignature = message.signer !== null || message.sig !== "";
        if (workspace.requireSignatures || carriesSignature) {
          if (!workspace.registry) {
            audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: BUS_CODES.UNCONFIGURED, id: message.id });
            sendJson(res, 403, { error: BUS_CODES.UNCONFIGURED });
            return;
          }
          const verdict = verifyBusMessage(message, workspace.registry);
          if (!verdict.ok) {
            audit({ t: now(), event: "message_refused", workspace: workspace.id, agent, code: verdict.code, id: message.id });
            sendJson(res, 403, { error: verdict.code });
            return;
          }
        }
        const existing = state.messages.find((stored) => stored.envelope.id === message.id);
        if (existing) {
          sendJson(res, 200, { ok: true, id: message.id, seq: existing.seq, duplicate: true });
          return;
        }
        const stored = state.append(message, now());
        audit({ t: now(), event: "message", workspace: workspace.id, agent, id: message.id, kind: message.kind, toAgent: message.toAgent, seq: stored.seq });
        sendJson(res, 200, { ok: true, id: message.id, seq: stored.seq });
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

// ---------------------------------------------------------------------------
// Startup, including the daemon's recovery discipline: claim + presence
// state is rebuilt from the append-only audit log (messages are signals
// and are never replayed; a claim whose lease lapsed while the relay was
// down recovers as free).
// ---------------------------------------------------------------------------

export function recoverRelayStateFromAuditLog(path: string, now: () => number = Date.now): RelayRecoveredState {
  const recovered = new Map<string, { claims: Map<string, Claim>; presence: Map<string, number> }>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return new Map();
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry.workspace !== "string") continue;
    let workspaceState = recovered.get(entry.workspace);
    if (!workspaceState) {
      workspaceState = { claims: new Map(), presence: new Map() };
      recovered.set(entry.workspace, workspaceState);
    }
    if (typeof entry.agent === "string" && typeof entry.t === "number") {
      workspaceState.presence.set(entry.agent, Math.max(workspaceState.presence.get(entry.agent) ?? 0, entry.t));
    }
    if (entry.event === "claim_granted" && typeof entry.item === "string" && typeof entry.agent === "string" && typeof entry.expiresAt === "number") {
      if (entry.expiresAt > now()) workspaceState.claims.set(entry.item, { holder: entry.agent, expiresAt: entry.expiresAt });
      else workspaceState.claims.delete(entry.item);
    }
    if ((entry.event === "claim_released" || entry.event === "claim_expired") && typeof entry.item === "string") {
      workspaceState.claims.delete(entry.item);
    }
  }
  return new Map([...recovered].map(([id, state]) => [id, {
    claims: [...state.claims.entries()],
    presence: [...state.presence.entries()],
  }]));
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

function relayRateLimitFromEnvironment(): Partial<RemoteRateLimit> | undefined {
  const limitRaw = process.env.SOLVELANG_RELAY_RATE_LIMIT;
  const windowRaw = process.env.SOLVELANG_RELAY_RATE_WINDOW_MS;
  if (limitRaw === undefined && windowRaw === undefined) return undefined;
  const parsed: { limit?: number; windowMs?: number } = {};
  if (limitRaw !== undefined) {
    const limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit)) throw new Error("SOLVELANG_RELAY_RATE_LIMIT must be an integer (0 disables the limiter).");
    parsed.limit = limit;
  }
  if (windowRaw !== undefined) {
    const windowMs = Number(windowRaw);
    if (!Number.isSafeInteger(windowMs)) throw new Error("SOLVELANG_RELAY_RATE_WINDOW_MS must be an integer number of milliseconds.");
    parsed.windowMs = windowMs;
  }
  return parsed;
}

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
  const rateLimit = options.rateLimit ?? relayRateLimitFromEnvironment();
  const auditLogPath = options.auditLogPath ?? process.env.SOLVELANG_RELAY_AUDIT_LOG;
  let auditStream: WriteStream | undefined;
  if (auditLogPath) {
    auditStream = createWriteStream(auditLogPath, { flags: "a" });
  }
  const audit = auditStream
    ? (entry: RelayAuditEntry) => { auditStream!.write(JSON.stringify(entry) + "\n"); }
    : undefined;
  const recovered = auditLogPath ? recoverRelayStateFromAuditLog(auditLogPath) : undefined;
  const server = createRelayHttpServer({ config, rateLimit, trustProxy, audit, recovered });
  if (audit) {
    let recoveredClaims = 0;
    if (recovered) for (const state of recovered.values()) recoveredClaims += state.claims.length;
    audit({ t: Date.now(), event: "relay_start", recoveredClaims });
  }
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
