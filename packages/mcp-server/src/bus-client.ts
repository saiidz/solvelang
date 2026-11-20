import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import path from "node:path";
import {
  BUS_CODES,
  BUS_DAEMON_AGENT,
  BusDedup,
  BusError,
  createBusMessage,
  signBusMessage,
  validateBusMessage,
  verifyBusMessage,
  type BusAuthMode,
  type BusKeyRegistry,
  type BusMessage,
  type BusMessageKind,
  type BusPrivateKey,
} from "./bus-envelope.js";

// Bus client library (Phase 6). One client per agent. It speaks to
// the workspace daemon for low-latency signals and atomic claims,
// and it writes every directed message as a handoff document in the
// workspace inbox as well — documents carry truth, the bus carries
// signals. That pairing is the kill switch: when the daemon is
// unreachable or dies mid-run, waits and sends complete through the
// documents alone, with no state loss, and claims degrade to the
// document behaviour (best-effort, conflicts possible at write time)
// instead of failing. `usingFallback` reports that degradation
// honestly instead of hiding it.

export const BUS_DEFAULT_POLL_MS = 800;
export const BUS_DEFAULT_REQUEST_TIMEOUT_MS = 1_500;

export interface BusStateFile {
  format: "solvelang.bus.state";
  version: 1;
  workspace: string;
  supervisorPid: number | null;
  daemonPid: number | null;
  port: number;
  logPath: string;
  authMode: BusAuthMode;
  startedAt: number;
}

/** Default per-workspace bus directory: `<workspace>/.solvelang/bus`. */
export function busStateDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".solvelang", "bus");
}

export function readBusStateFile(stateFilePath: string): BusStateFile {
  const value = JSON.parse(readFileSync(stateFilePath, "utf8")) as BusStateFile;
  if (value.format !== "solvelang.bus.state" || value.version !== 1 || !Number.isSafeInteger(value.port)) {
    throw new BusError(BUS_CODES.MALFORMED, `bus state file ${stateFilePath} is not a solvelang.bus.state v1 document.`);
  }
  return value;
}

export interface BusClientOptions {
  /** This agent's name — the same name its handoff documents use. */
  agent: string;
  /** Daemon port. Either this or `stateFile` (or `workspaceDir`) is required. */
  port?: number;
  host?: string;
  /** Path to the CLI's bus-state.json; the port is read from it. */
  stateFile?: string;
  /** Workspace root; derives the state file, inbox and claims dirs. */
  workspaceDir?: string;
  /** Handoff-document inbox root (per-agent subdirectories). Defaults from workspaceDir. */
  inboxDir?: string;
  /** Document-claim directory for the bus-down fallback. Defaults from workspaceDir. */
  claimsDir?: string;
  /** When set, outgoing messages are signed with this Phase 4 key. */
  privateKey?: BusPrivateKey;
  /**
   * When set, the client runs in registry mode: incoming agent
   * messages are verified against this registry and authenticity
   * failures are refused (dropped, reported via `onRefused`), and
   * claim/release requests carry signed envelopes.
   */
  registry?: BusKeyRegistry;
  pollMs?: number;
  requestTimeoutMs?: number;
  /** Called when an incoming message fails authenticity verification. */
  onRefused?: (info: { code: string; message: BusMessage }) => void;
  /** Called once when the client first degrades to document fallback. */
  onFallback?: () => void;
}

export interface BusClaimResult {
  granted: boolean;
  holder?: string;
  /** True when the daemon decided; false when documents decided (best-effort). */
  viaBus: boolean;
}

export interface BusPresenceResult {
  agent: string;
  lastSeen: number | null;
  silentMs: number | null;
  viaBus: boolean;
}

type Waiter = {
  want: (message: BusMessage) => boolean;
  resolve: (message: BusMessage) => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BusClient {
  readonly agent: string;
  /** Latched true once any wait/claim completes through documents. */
  usingFallback = false;

  readonly #host: string;
  readonly #port: number;
  readonly #inboxDir: string | null;
  readonly #claimsDir: string | null;
  readonly #privateKey: BusPrivateKey | undefined;
  readonly #registry: BusKeyRegistry | undefined;
  readonly #pollMs: number;
  readonly #requestTimeoutMs: number;
  readonly #onRefused: BusClientOptions["onRefused"];
  readonly #onFallback: BusClientOptions["onFallback"];

  #socket: Socket | null = null;
  #dead = true;
  #closed = false;
  #seq = 0;
  readonly #pending = new Map<string, (reply: Record<string, unknown> | null) => void>();
  #waiters: Waiter[] = [];
  /** Cancel functions for live waits; close() runs them all. */
  readonly #activeWaits = new Set<() => void>();
  readonly #dedup = new BusDedup();
  #heartbeat: NodeJS.Timeout | null = null;

  private constructor(port: number, options: BusClientOptions) {
    this.agent = options.agent;
    this.#host = options.host ?? "127.0.0.1";
    this.#port = port;
    const workspaceDir = options.workspaceDir;
    this.#inboxDir = options.inboxDir ?? (workspaceDir ? path.join(busStateDir(workspaceDir), "inbox") : null);
    this.#claimsDir = options.claimsDir ?? (workspaceDir ? path.join(busStateDir(workspaceDir), "claims") : null);
    this.#privateKey = options.privateKey;
    this.#registry = options.registry;
    this.#pollMs = options.pollMs ?? BUS_DEFAULT_POLL_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? BUS_DEFAULT_REQUEST_TIMEOUT_MS;
    this.#onRefused = options.onRefused;
    this.#onFallback = options.onFallback;
    if (this.#registry && !this.#privateKey) {
      // Verification without a signing key is a legitimate read-only
      // posture; sending in registry mode will be refused by the
      // daemon (bus_unsigned) and claim requests cannot be signed.
    }
  }

  static async connect(options: BusClientOptions): Promise<BusClient> {
    let port = options.port;
    if (port === undefined) {
      const stateFile =
        options.stateFile ?? (options.workspaceDir ? path.join(busStateDir(options.workspaceDir), "bus-state.json") : null);
      if (!stateFile) {
        throw new BusError(BUS_CODES.UNCONFIGURED, "BusClient.connect needs a port, a stateFile, or a workspaceDir.");
      }
      port = readBusStateFile(stateFile).port;
    }
    const client = new BusClient(port, options);
    await client.#open();
    return client;
  }

  get connected(): boolean {
    return !this.#dead;
  }

  get authMode(): BusAuthMode {
    return this.#registry ? "registry" : "local-open";
  }

  #markFallback(): void {
    if (!this.usingFallback) {
      this.usingFallback = true;
      this.#onFallback?.();
    }
  }

  async #open(): Promise<void> {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = netConnect(this.#port, this.#host);
      this.#socket = socket;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          let value: Record<string, unknown>;
          try {
            value = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (value.push !== undefined) {
            this.#receivePush(value.push);
          } else if (typeof value.op === "string" && typeof value._seq === "number") {
            const key = `${value.op}:${value._seq}`;
            const pending = this.#pending.get(key);
            if (pending) {
              this.#pending.delete(key);
              pending(value);
            }
          }
        }
      });
      socket.on("error", () => {
        this.#dead = true;
      });
      socket.on("close", () => {
        this.#dead = true;
        for (const pending of this.#pending.values()) pending(null);
        this.#pending.clear();
      });
      socket.once("error", () => resolve(false));
      socket.on("connect", () => {
        this.#dead = false;
        resolve(true);
      });
    });
    if (!connected) {
      // The kill switch as a starting condition: no daemon is a
      // normal state, not an error. The client runs on handoff
      // documents alone until closed.
      this.#dead = true;
      this.#markFallback();
      return;
    }
    const reply = await this.#request({ op: "subscribe", agent: this.agent });
    if (!reply || reply.ok !== true) {
      this.#dead = true;
      throw new BusError(BUS_CODES.NOT_SUBSCRIBED, "bus daemon refused the subscription.");
    }
  }

  #raw(value: Record<string, unknown>): void {
    try {
      this.#socket?.write(`${JSON.stringify(value)}\n`);
    } catch {
      this.#dead = true;
    }
  }

  #request(value: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.#dead) return Promise.resolve(null);
    return new Promise((resolve) => {
      const seq = ++this.#seq;
      const key = `${value.op}:${seq}`;
      this.#pending.set(key, resolve);
      this.#raw({ ...value, _seq: seq });
      setTimeout(() => {
        if (this.#pending.has(key)) {
          this.#pending.delete(key);
          this.#dead = true;
          resolve(null);
        }
      }, this.#requestTimeoutMs).unref();
    });
  }

  /**
   * Verify an incoming message in registry mode. Daemon system
   * signals are local control traffic (unsigned by construction) and
   * are accepted as such; agent messages must verify.
   */
  #acceptIncoming(message: BusMessage): boolean {
    if (this.#registry && message.fromAgent !== BUS_DAEMON_AGENT) {
      const verdict = verifyBusMessage(message, this.#registry);
      if (!verdict.ok) {
        this.#onRefused?.({ code: verdict.code, message });
        return false;
      }
    }
    return true;
  }

  #receivePush(raw: unknown): void {
    let message: BusMessage;
    try {
      message = validateBusMessage(raw);
    } catch {
      return;
    }
    if (!this.#acceptIncoming(message)) return;
    // A message is marked as seen only when a waiter actually
    // consumes it. A push that arrives before any matching wait is
    // registered stays unmarked, so the handoff document in the
    // inbox can still deliver it to a later wait through the scan;
    // marking it here would poison that scan and lose the message.
    const matched = this.#waiters.filter((waiter) => waiter.want(message));
    if (matched.length === 0) return;
    if (!this.#dedup.accept(message)) return;
    this.#waiters = this.#waiters.filter((waiter) => !matched.includes(waiter));
    for (const waiter of matched) waiter.resolve(message);
  }

  /** Persist a directed message as a handoff document in the peer's inbox. */
  #writeDocument(message: BusMessage): void {
    if (!this.#inboxDir || message.toAgent === "*") return;
    const dir = path.join(this.#inboxDir, message.toAgent);
    mkdirSync(dir, { recursive: true });
    const temporary = path.join(dir, `.tmp-${message.id}`);
    writeFileSync(temporary, JSON.stringify(message));
    renameSync(temporary, path.join(dir, `${message.id}.json`));
  }

  #scanInbox(want: (message: BusMessage) => boolean): BusMessage | null {
    if (!this.#inboxDir) return null;
    const dir = path.join(this.#inboxDir, this.agent);
    if (!existsSync(dir)) return null;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      let message: BusMessage;
      try {
        message = validateBusMessage(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
      } catch {
        continue;
      }
      if (!want(message)) continue;
      if (!this.#acceptIncoming(message)) continue;
      // Only the matched message is consumed; other documents stay
      // available for later waits with different predicates.
      if (!this.#dedup.accept(message)) continue;
      return message;
    }
    return null;
  }

  async #pollSignal(want: (message: BusMessage) => boolean): Promise<BusMessage> {
    this.#markFallback();
    for (;;) {
      // A closed client's waits never settle; they simply stop
      // consuming the event loop.
      if (this.#closed) return new Promise<BusMessage>(() => {});
      const found = this.#scanInbox(want);
      if (found) return found;
      await sleep(this.#pollMs);
    }
  }

  /**
   * Send a message: build the envelope, sign it when a key is
   * configured, persist it as a handoff document (directed messages),
   * and relay it through the daemon when connected. A daemon refusal
   * (for example `bus_unsigned` in registry mode) throws `BusError`
   * with the refusal code — fail-closed, never silently downgraded.
   * When the daemon is down the document is the delivery and the
   * send succeeds through it.
   */
  async send(input: {
    toAgent: string;
    kind: BusMessageKind;
    body?: unknown;
    ref?: string | null;
  }): Promise<BusMessage> {
    let message = createBusMessage({ fromAgent: this.agent, ...input });
    if (this.#privateKey) message = signBusMessage(message, this.#privateKey);
    this.#writeDocument(message);
    if (!this.#dead) {
      const reply = await this.#request({ op: "send", msg: message });
      if (reply && reply.ok !== true) {
        throw new BusError(
          typeof reply.error === "string" ? reply.error : BUS_CODES.MALFORMED,
          `bus daemon refused the message (${String(reply.error)}).`,
        );
      }
      if (!reply) this.#markFallback();
    } else {
      this.#markFallback();
    }
    return message;
  }

  sendSignal(toAgent: string, body: unknown, ref?: string | null): Promise<BusMessage> {
    return this.send({ toAgent, kind: "signal", body, ref });
  }

  /**
   * Wait for a message matching the predicate. While the daemon is
   * alive this is a push wait; if the daemon dies mid-wait (or was
   * never up) the wait degrades to polling the handoff documents —
   * the kill switch, with no state loss.
   */
  async waitSignal(want: (message: BusMessage) => boolean): Promise<BusMessage> {
    if (this.#dead) return this.#pollSignal(want);
    return new Promise<BusMessage>((resolve) => {
      let settled = false;
      const waiter: Waiter = {
        want,
        resolve: (message) => finish(message),
      };
      const timers: NodeJS.Timeout[] = [];
      const cancel = (): void => {
        // Abandon the wait without settling it: its timers stop and
        // its waiter is removed, so a closed or abandoned client
        // never keeps a process alive on a wait nobody is using.
        if (settled) return;
        settled = true;
        for (const timer of timers) clearInterval(timer);
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
        this.#activeWaits.delete(cancel);
      };
      const finish = (message: BusMessage): void => {
        if (settled) return;
        cancel();
        resolve(message);
      };
      this.#activeWaits.add(cancel);
      this.#waiters.push(waiter);
      // A peer whose own daemon connection dropped delivers by
      // document only; sweep the inbox periodically so such a
      // message is still picked up without waiting for our own
      // connection to die. These timers are deliberately ref'd: a
      // pending wait is real work and must keep the process alive
      // even when the daemon (and its socket handle) is gone.
      const scanTimer = setInterval(() => {
        const found = this.#scanInbox(want);
        if (found) finish(found);
      }, this.#pollMs);
      timers.push(scanTimer);
      // Kill-switch watchdog: the daemon dying mid-wait degrades
      // this wait to document polling with no state loss.
      const watchTimer = setInterval(() => {
        if (this.#dead) {
          this.#markFallback();
          const found = this.#scanInbox(want);
          if (found) finish(found);
        }
      }, 50);
      timers.push(watchTimer);
      const immediate = this.#scanInbox(want);
      if (immediate) finish(immediate);
    });
  }

  waitForSignalKind(kind: BusMessageKind, bodyTest?: (body: unknown) => boolean): Promise<BusMessage> {
    return this.waitSignal((message) => message.kind === kind && (bodyTest ? bodyTest(message.body) : true));
  }

  #claimEnvelope(kind: "claim" | "release", item: string): BusMessage | undefined {
    if (!this.#registry) return undefined;
    if (!this.#privateKey) {
      throw new BusError(
        BUS_CODES.UNSIGNED,
        "registry mode claim/release requires a signing key; this client has none.",
      );
    }
    return signBusMessage(createBusMessage({ fromAgent: this.agent, toAgent: BUS_DAEMON_AGENT, kind, body: { item } }), this.#privateKey);
  }

  /**
   * Claim a work item. Through the daemon the grant is atomic and
   * lease-bound. Through documents (daemon down) the claim is
   * best-effort: this agent records its claim document and yields to
   * an earlier unexpired claim by a peer — races remain possible,
   * which is exactly the degradation the design documents.
   */
  async claim(item: string, ttlMs = 30_000): Promise<BusClaimResult> {
    if (!this.#dead) {
      const reply = await this.#request({
        op: "claim",
        item,
        ttlMs,
        msg: this.#claimEnvelope("claim", item),
      });
      if (reply) {
        if (reply.ok !== true) {
          throw new BusError(
            typeof reply.error === "string" ? reply.error : BUS_CODES.MALFORMED,
            `bus daemon refused the claim (${String(reply.error)}).`,
          );
        }
        return {
          granted: reply.granted === true,
          ...(typeof reply.holder === "string" ? { holder: reply.holder } : {}),
          viaBus: true,
        };
      }
    }
    this.#markFallback();
    return this.#claimViaDocuments(item, ttlMs);
  }

  #claimViaDocuments(item: string, ttlMs: number): BusClaimResult {
    if (!this.#claimsDir) return { granted: true, viaBus: false };
    const dir = path.join(this.#claimsDir, item);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const mine = createBusMessage({
      fromAgent: this.agent,
      toAgent: BUS_DAEMON_AGENT,
      kind: "claim",
      body: { item, expiresAt: now + ttlMs },
      ts: now,
    });
    writeFileSync(path.join(dir, `${this.agent}.json`), JSON.stringify(mine));
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json") || file === `${this.agent}.json`) continue;
      try {
        const other = validateBusMessage(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
        const body = other.body as { expiresAt?: unknown } | null;
        const expiresAt = typeof body?.expiresAt === "number" ? body.expiresAt : 0;
        if (expiresAt > now && other.ts <= mine.ts && other.fromAgent !== this.agent) {
          return { granted: false, holder: other.fromAgent, viaBus: false };
        }
      } catch {
        continue;
      }
    }
    return { granted: true, viaBus: false };
  }

  async release(item: string): Promise<void> {
    if (!this.#dead) {
      const reply = await this.#request({
        op: "release",
        item,
        msg: this.#claimEnvelope("release", item),
      });
      if (reply && reply.ok !== true) {
        throw new BusError(
          typeof reply.error === "string" ? reply.error : BUS_CODES.MALFORMED,
          `bus daemon refused the release (${String(reply.error)}).`,
        );
      }
      if (reply) return;
    }
    this.#markFallback();
    if (this.#claimsDir) {
      const file = path.join(this.#claimsDir, item, `${this.agent}.json`);
      if (existsSync(file)) unlinkSync(file);
    }
  }

  async presence(agent: string): Promise<BusPresenceResult> {
    if (!this.#dead) {
      const reply = await this.#request({ op: "presence", agent });
      if (reply && reply.ok === true) {
        return {
          agent,
          lastSeen: typeof reply.lastSeen === "number" ? reply.lastSeen : null,
          silentMs: typeof reply.silentMs === "number" ? reply.silentMs : null,
          viaBus: true,
        };
      }
    }
    this.#markFallback();
    return { agent, lastSeen: null, silentMs: null, viaBus: false };
  }

  /** Heartbeat: refresh this agent's last-seen in the daemon. */
  ping(): void {
    if (!this.#dead) this.#raw({ op: "ping", agent: this.agent });
  }

  startHeartbeat(intervalMs = 400): void {
    this.stopHeartbeat();
    this.#heartbeat = setInterval(() => this.ping(), intervalMs);
    this.#heartbeat.unref();
  }

  stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  close(): void {
    this.stopHeartbeat();
    this.#dead = true;
    this.#closed = true;
    for (const cancel of [...this.#activeWaits]) cancel();
    this.#socket?.destroy();
    this.#socket = null;
  }
}
