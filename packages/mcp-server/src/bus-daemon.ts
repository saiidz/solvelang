import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import {
  BUS_CODES,
  BUS_DAEMON_AGENT,
  BusError,
  createBusMessage,
  validateBusMessage,
  verifyBusMessage,
  type BusAuthMode,
  type BusKeyRegistry,
  type BusMessage,
} from "./bus-envelope.js";

// The bus daemon (Phase 6, design Option A productized): a small
// localhost TCP process speaking newline-delimited JSON. It routes
// envelope pushes between subscribed agents, grants work claims
// atomically under leases, tracks presence by last-seen, and writes
// every routing decision to an append-only audit log.
//
// The daemon holds no truth. Messages are signals; the handoff
// documents clients write remain the record, and when the daemon is
// down clients fall back to those documents with no state loss. The
// audit log exists so claim state can be recovered after a restart
// and so every grant, denial, release, expiry and refusal is provable
// after the fact.
//
// Wire protocol (one JSON object per line; replies echo `_seq`):
//   {op:"subscribe", agent}            -> {ok, op:"subscribe", authMode}
//   {op:"send", msg}                   -> {ok, op:"send", id} | {ok:false, error}
//   {op:"claim", item, ttlMs?, msg?}   -> {ok, op:"claim", granted, holder?}
//   {op:"release", item, msg?}         -> {ok, op:"release"}
//   {op:"ping", agent?}                -> {ok, op:"ping"}
//   {op:"presence", agent}             -> {ok, op:"presence", lastSeen, silentMs}
//   {op:"status"}                      -> {ok, op:"status", ...}
//   pushes arrive as {push: <envelope>}
//
// In registry auth mode, `send` requires a validly signed envelope
// whose fromAgent matches the subscribed agent, and `claim`/`release`
// require a signed envelope of the matching kind in `msg` (body
// {item}) — the daemon is the claim authority, so it verifies before
// it grants. Daemon-originated system signals (claim released /
// expired) are unsigned by construction: they originate inside this
// process on this machine, carry no substance, and are marked
// fromAgent "daemon"; consumers treat them as local control signals,
// never as evidence.

export const BUS_DEFAULT_PORT = 0;
export const BUS_DEFAULT_HOST = "127.0.0.1" as const;
export const BUS_DEFAULT_MAX_LOG_BYTES = 8 * 1024 * 1024;
export const BUS_DEFAULT_MAX_LOG_ARCHIVES = 3;
export const BUS_DEFAULT_CLAIM_TTL_MS = 30_000;
export const BUS_MAX_CLAIM_TTL_MS = 10 * 60_000;
export const BUS_DEFAULT_SWEEP_MS = 100;

export interface BusDaemonOptions {
  /** Append-only audit log path (JSONL). Created with its parent directory. */
  logPath: string;
  /** Default 0 (ephemeral); the CLI records the chosen port in its state file. */
  port?: number;
  /** Localhost only in v1; anything else is refused at startup. */
  host?: string;
  /**
   * Default: `"registry"` when a registry is supplied, else
   * `"local-open"`. `"registry"` without a registry is refused.
   */
  authMode?: BusAuthMode;
  registry?: BusKeyRegistry;
  /** Rotate the audit log past this size. Default 8 MiB. */
  maxLogBytes?: number;
  /** Archived segments kept (`.1` newest … `.N` oldest). Default 3. */
  maxLogArchives?: number;
  /** Test hook: deliver every push twice (at-least-once exercise). */
  duplicateDeliveries?: boolean;
  sweepMs?: number;
  now?: () => number;
}

export interface BusDaemonStatus {
  authMode: BusAuthMode;
  claims: number;
  agents: string[];
  logBytes: number;
  startedAt: number;
}

export interface BusDaemonHandle {
  readonly port: number;
  readonly authMode: BusAuthMode;
  status(): BusDaemonStatus;
  close(): Promise<void>;
}

interface Claim {
  holder: string;
  expiresAt: number;
}

interface AuditEntry {
  t: number;
  event: string;
  [field: string]: unknown;
}

/**
 * Append-only JSONL audit log with bounded size rotation. Writes are
 * synchronous appends: an audit entry that was acknowledged is on
 * disk, even if the daemon is killed a millisecond later. Rotation
 * renames whole segments (`log` -> `log.1` -> `log.2` -> `log.3`,
 * oldest deleted) and never truncates the live segment mid-line, so
 * the trail is the concatenation of the segments, oldest first.
 */
class AuditLog {
  readonly #logPath: string;
  readonly #maxBytes: number;
  readonly #maxArchives: number;
  readonly #now: () => number;
  #bytes: number;

  constructor(logPath: string, maxBytes: number, maxArchives: number, now: () => number) {
    this.#logPath = logPath;
    this.#maxBytes = Math.max(1_024, maxBytes);
    this.#maxArchives = Math.max(0, maxArchives);
    this.#now = now;
    mkdirSync(path.dirname(logPath), { recursive: true });
    this.#bytes = existsSync(logPath) ? statSync(logPath).size : 0;
  }

  get bytes(): number {
    return this.#bytes;
  }

  segmentPathsOldestFirst(): string[] {
    const segments: string[] = [];
    for (let index = this.#maxArchives; index >= 1; index--) {
      const candidate = `${this.#logPath}.${index}`;
      if (existsSync(candidate)) segments.push(candidate);
    }
    if (existsSync(this.#logPath)) segments.push(this.#logPath);
    return segments;
  }

  write(entry: AuditEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    const size = Buffer.byteLength(line, "utf8");
    if (this.#bytes > 0 && this.#bytes + size > this.#maxBytes) this.#rotate();
    appendFileSync(this.#logPath, line, "utf8");
    this.#bytes += size;
  }

  #rotate(): void {
    if (this.#maxArchives === 0) {
      // No archives configured: the bound is enforced by starting a
      // fresh segment; the rotated content is dropped by operator
      // choice, and the rotation itself is recorded in the new log.
      if (existsSync(this.#logPath)) unlinkSync(this.#logPath);
    } else {
      const oldest = `${this.#logPath}.${this.#maxArchives}`;
      if (existsSync(oldest)) unlinkSync(oldest);
      for (let index = this.#maxArchives - 1; index >= 1; index--) {
        const source = `${this.#logPath}.${index}`;
        if (existsSync(source)) renameSync(source, `${this.#logPath}.${index + 1}`);
      }
      renameSync(this.#logPath, `${this.#logPath}.1`);
    }
    this.#bytes = 0;
    this.write({ t: this.#now(), event: "log_rotated", maxBytes: this.#maxBytes, maxArchives: this.#maxArchives });
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function startBusDaemon(options: BusDaemonOptions): Promise<BusDaemonHandle> {
  const now = options.now ?? Date.now;
  const host = options.host ?? BUS_DEFAULT_HOST;
  if (!isLoopbackHost(host)) {
    throw new BusError(
      BUS_CODES.UNCONFIGURED,
      `bus daemon binds localhost only in this version (got ${JSON.stringify(host)}); cross-machine relay is a separate, gated design.`,
    );
  }
  const authMode: BusAuthMode = options.authMode ?? (options.registry ? "registry" : "local-open");
  if (authMode === "registry" && !options.registry) {
    throw new BusError(BUS_CODES.UNCONFIGURED, "registry auth mode requires a key registry.");
  }
  const registry = options.registry;

  const log = new AuditLog(
    options.logPath,
    options.maxLogBytes ?? BUS_DEFAULT_MAX_LOG_BYTES,
    options.maxLogArchives ?? BUS_DEFAULT_MAX_LOG_ARCHIVES,
    now,
  );

  const subscribers = new Map<string, Set<Socket>>();
  const claims = new Map<string, Claim>();
  const presence = new Map<string, number>();
  const startedAt = now();

  // Recover claim + presence state from the audit trail (segments
  // oldest first). Messages are signals and are not replayed; claims
  // and last-seen are the only daemon state worth recovering, and a
  // claim whose lease has already lapsed recovers as free.
  for (const segment of log.segmentPathsOldestFirst()) {
    for (const line of readFileSync(segment, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch {
        continue;
      }
      if (typeof entry.agent === "string" && typeof entry.t === "number") {
        presence.set(entry.agent, Math.max(presence.get(entry.agent) ?? 0, entry.t));
      }
      if (entry.event === "claim_granted" && typeof entry.item === "string" && typeof entry.agent === "string") {
        if (typeof entry.expiresAt === "number" && entry.expiresAt > now()) {
          claims.set(entry.item, { holder: entry.agent, expiresAt: entry.expiresAt });
        } else {
          claims.delete(entry.item);
        }
      } else if (
        (entry.event === "claim_released" || entry.event === "claim_expired") &&
        typeof entry.item === "string"
      ) {
        claims.delete(entry.item);
      }
    }
  }
  log.write({ t: now(), event: "daemon_start", authMode, recoveredClaims: claims.size });

  const audit = (entry: Omit<AuditEntry, "t">): void => log.write({ ...entry, t: now() } as AuditEntry);

  function push(agent: string, message: BusMessage): void {
    const sockets = subscribers.get(agent);
    if (!sockets) return;
    const line = `${JSON.stringify({ push: message })}\n`;
    for (const socket of sockets) {
      socket.write(line);
      if (options.duplicateDeliveries) socket.write(line);
    }
  }

  function broadcast(message: BusMessage): void {
    for (const agent of subscribers.keys()) push(agent, message);
  }

  function systemSignal(signal: string, item: string): BusMessage {
    return createBusMessage({
      fromAgent: BUS_DAEMON_AGENT,
      toAgent: "*",
      kind: "signal",
      body: { signal, item },
      ts: now(),
    });
  }

  function sweepExpired(): void {
    const at = now();
    for (const [item, claim] of claims) {
      if (claim.expiresAt <= at) {
        claims.delete(item);
        audit({ event: "claim_expired", item, agent: claim.holder });
        broadcast(systemSignal("claim_expired", item));
      }
    }
  }
  const sweep = setInterval(sweepExpired, options.sweepMs ?? BUS_DEFAULT_SWEEP_MS);
  sweep.unref();

  /**
   * Verify a claim/release request's attached envelope in registry
   * mode. Returns a refusal code, or null when the request may
   * proceed. In local-open mode there is nothing to verify.
   */
  function verifyClaimEnvelope(
    req: Record<string, unknown>,
    agent: string,
    kind: "claim" | "release",
    item: string,
  ): string | null {
    if (authMode !== "registry") return null;
    if (req.msg === undefined) return BUS_CODES.UNSIGNED;
    let message: BusMessage;
    try {
      message = validateBusMessage(req.msg);
    } catch (error) {
      return error instanceof BusError ? error.code : BUS_CODES.MALFORMED;
    }
    if (message.kind !== kind) return BUS_CODES.MALFORMED;
    if (message.fromAgent !== agent) return BUS_CODES.SENDER_MISMATCH;
    const body = message.body as { item?: unknown } | null;
    if (body === null || typeof body !== "object" || body.item !== item) return BUS_CODES.MALFORMED;
    const verdict = verifyBusMessage(message, registry as BusKeyRegistry);
    return verdict.ok ? null : verdict.code;
  }

  const server: Server = createServer((socket) => {
    let buffer = "";
    let agent: string | null = null;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        let req: Record<string, unknown>;
        try {
          req = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const reply = (value: Record<string, unknown>): void => {
          socket.write(`${JSON.stringify({ ...value, _seq: req._seq })}\n`);
        };
        if (req.op === "subscribe") {
          if (typeof req.agent !== "string" || req.agent.length === 0) {
            reply({ ok: false, op: "subscribe", error: BUS_CODES.MALFORMED });
            continue;
          }
          agent = req.agent;
          if (!subscribers.has(agent)) subscribers.set(agent, new Set());
          subscribers.get(agent)?.add(socket);
          presence.set(agent, now());
          audit({ event: "subscribe", agent });
          reply({ ok: true, op: "subscribe", authMode });
        } else if (req.op === "send") {
          if (agent === null) {
            reply({ ok: false, op: "send", error: BUS_CODES.NOT_SUBSCRIBED });
            continue;
          }
          let message: BusMessage;
          try {
            message = validateBusMessage(req.msg);
          } catch (error) {
            reply({ ok: false, op: "send", error: error instanceof BusError ? error.code : BUS_CODES.MALFORMED });
            continue;
          }
          if (message.fromAgent !== agent) {
            audit({ event: "message_refused", code: BUS_CODES.SENDER_MISMATCH, id: message.id, agent });
            reply({ ok: false, op: "send", error: BUS_CODES.SENDER_MISMATCH });
            continue;
          }
          if (authMode === "registry") {
            const verdict = verifyBusMessage(message, registry as BusKeyRegistry);
            if (!verdict.ok) {
              audit({ event: "message_refused", code: verdict.code, id: message.id, agent });
              reply({ ok: false, op: "send", error: verdict.code });
              continue;
            }
          }
          audit({ event: "message", agent, msg: message });
          if (message.toAgent === "*") broadcast(message);
          else push(message.toAgent, message);
          reply({ ok: true, op: "send", id: message.id });
        } else if (req.op === "claim" || req.op === "release") {
          if (agent === null) {
            reply({ ok: false, op: req.op, error: BUS_CODES.NOT_SUBSCRIBED });
            continue;
          }
          if (typeof req.item !== "string" || req.item.length === 0) {
            reply({ ok: false, op: req.op, error: BUS_CODES.MALFORMED });
            continue;
          }
          const item = req.item;
          const refusal = verifyClaimEnvelope(req, agent, req.op, item);
          if (refusal !== null) {
            audit({ event: "message_refused", code: refusal, agent, item });
            reply({ ok: false, op: req.op, error: refusal });
            continue;
          }
          if (req.op === "claim") {
            sweepExpired();
            const requested = typeof req.ttlMs === "number" && Number.isFinite(req.ttlMs) ? req.ttlMs : BUS_DEFAULT_CLAIM_TTL_MS;
            const ttlMs = Math.min(Math.max(1, Math.floor(requested)), BUS_MAX_CLAIM_TTL_MS);
            const current = claims.get(item);
            if (!current || current.holder === agent) {
              // A claim by the current holder renews the lease.
              const expiresAt = now() + ttlMs;
              claims.set(item, { holder: agent, expiresAt });
              audit({ event: "claim_granted", item, agent, expiresAt });
              reply({ ok: true, op: "claim", granted: true });
            } else {
              audit({ event: "claim_denied", item, agent, holder: current.holder });
              reply({ ok: true, op: "claim", granted: false, holder: current.holder });
            }
          } else {
            const current = claims.get(item);
            if (current && current.holder === agent) {
              claims.delete(item);
              audit({ event: "claim_released", item, agent });
              broadcast(systemSignal("claim_released", item));
            }
            reply({ ok: true, op: "release" });
          }
        } else if (req.op === "ping") {
          const who = typeof req.agent === "string" ? req.agent : agent;
          if (who) presence.set(who, now());
          reply({ ok: true, op: "ping" });
        } else if (req.op === "presence") {
          const who = typeof req.agent === "string" ? req.agent : "";
          const lastSeen = presence.get(who) ?? null;
          reply({
            ok: true,
            op: "presence",
            agent: who,
            lastSeen,
            silentMs: lastSeen === null ? null : now() - lastSeen,
          });
        } else if (req.op === "status") {
          reply({ ok: true, op: "status", ...status() });
        } else {
          reply({ ok: false, error: BUS_CODES.MALFORMED });
        }
      }
    });
    socket.on("close", () => {
      if (agent && subscribers.has(agent)) subscribers.get(agent)?.delete(socket);
    });
    socket.on("error", () => {});
  });

  function status(): BusDaemonStatus {
    return {
      authMode,
      claims: claims.size,
      agents: [...presence.keys()],
      logBytes: log.bytes,
      startedAt,
    };
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? BUS_DEFAULT_PORT, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  let closed = false;
  return {
    port,
    authMode,
    status,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      audit({ event: "daemon_stop" });
      for (const sockets of subscribers.values()) {
        for (const socket of sockets) socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
