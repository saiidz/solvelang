#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect as netConnect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUS_CODES,
  BusError,
  BusKeyRegistry,
  type BusAuthMode,
} from "./bus-envelope.js";
import { startBusDaemon, type BusDaemonHandle } from "./bus-daemon.js";
import { busStateDir, readBusStateFile, type BusStateFile } from "./bus-client.js";

// solvelang-bus — lifecycle for the workspace bus daemon (Phase 6).
//
//   solvelang-bus start [--workspace <dir>] [--port <n>] [--keys <registry.json>]
//                       [--auth registry|local-open] [--max-log-bytes <n>]
//                       [--foreground]
//   solvelang-bus stop  [--workspace <dir>]
//   solvelang-bus status [--workspace <dir>]
//
// Lifecycle: `start` launches a detached supervisor for the
// workspace; the supervisor runs the daemon and restarts it after a
// crash (bounded: 5 restarts inside 60 seconds, then it gives up and
// says so in the supervisor log), because a coordination add-on that
// silently stays dead is worse than one that noisily does. State
// lives in <workspace>/.solvelang/bus/: bus-state.json (pids, port,
// auth mode), bus.jsonl (the daemon's append-only audit log, rotated
// by size), supervisor.log. `stop` asks the supervisor to shut the
// daemon down; clients degrade to handoff documents, so stopping the
// bus never loses state — the kill switch is a normal operation, not
// an emergency.
//
// Auth: with --keys (or SOLVELANG_BUS_KEYS) the daemon runs in
// registry mode and signatures are required. Without a registry it
// runs in the explicitly named local-open mode — localhost only, no
// authenticity — and says so at startup and in `status`.

interface BusConfig {
  workspace: string;
  port: number;
  keysPath: string | null;
  authMode: BusAuthMode;
  maxLogBytes: number | null;
  maxLogArchives: number | null;
}

const RESTART_LIMIT = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = 250;

function stateFilePath(workspace: string): string {
  return path.join(busStateDir(workspace), "bus-state.json");
}

function defaultLogPath(workspace: string): string {
  return path.join(busStateDir(workspace), "bus.jsonl");
}

function supervisorLogPath(workspace: string): string {
  return path.join(busStateDir(workspace), "supervisor.log");
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, string>; switches: Set<string> } {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      index++;
    } else {
      switches.add(name);
    }
  }
  return { command, flags, switches };
}

function resolveWorkspace(flags: Map<string, string>): string {
  return path.resolve(flags.get("workspace") ?? process.env.SOLVELANG_WORKSPACE_ROOT ?? process.cwd());
}

function resolveConfig(flags: Map<string, string>): BusConfig {
  const workspace = resolveWorkspace(flags);
  const keysPath = flags.get("keys") ?? process.env.SOLVELANG_BUS_KEYS ?? null;
  const authFlag = flags.get("auth");
  let authMode: BusAuthMode;
  if (authFlag !== undefined) {
    if (authFlag !== "registry" && authFlag !== "local-open") {
      throw new BusError(BUS_CODES.UNCONFIGURED, `--auth must be registry or local-open (got ${JSON.stringify(authFlag)}).`);
    }
    authMode = authFlag;
  } else {
    authMode = keysPath ? "registry" : "local-open";
  }
  if (authMode === "registry" && !keysPath) {
    throw new BusError(BUS_CODES.UNCONFIGURED, "registry auth mode requires --keys <registry.json> (a solvelang.key-registry v1 file).");
  }
  const portRaw = flags.get("port") ?? process.env.SOLVELANG_BUS_PORT;
  const port = portRaw === undefined ? 0 : Number(portRaw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new BusError(BUS_CODES.UNCONFIGURED, "--port must be an integer from 0 through 65535.");
  }
  const maxLogBytes = flags.has("max-log-bytes") ? Number(flags.get("max-log-bytes")) : null;
  if (maxLogBytes !== null && (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1_024)) {
    throw new BusError(BUS_CODES.UNCONFIGURED, "--max-log-bytes must be an integer of at least 1024.");
  }
  const maxLogArchives = flags.has("max-log-archives") ? Number(flags.get("max-log-archives")) : null;
  if (maxLogArchives !== null && (!Number.isSafeInteger(maxLogArchives) || maxLogArchives < 0)) {
    throw new BusError(BUS_CODES.UNCONFIGURED, "--max-log-archives must be a non-negative integer.");
  }
  return { workspace, port, keysPath, authMode, maxLogBytes, maxLogArchives };
}

function configToArgv(config: BusConfig): string[] {
  const argv = ["--workspace", config.workspace, "--port", String(config.port), "--auth", config.authMode];
  if (config.keysPath) argv.push("--keys", config.keysPath);
  if (config.maxLogBytes !== null) argv.push("--max-log-bytes", String(config.maxLogBytes));
  if (config.maxLogArchives !== null) argv.push("--max-log-archives", String(config.maxLogArchives));
  return argv;
}

function loadRegistry(config: BusConfig): BusKeyRegistry | undefined {
  if (!config.keysPath) return undefined;
  return BusKeyRegistry.fromText(readFileSync(config.keysPath, "utf8"));
}

function writeState(workspace: string, state: BusStateFile): void {
  mkdirSync(busStateDir(workspace), { recursive: true });
  writeFileSync(stateFilePath(workspace), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function pidAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readStateIfPresent(workspace: string): BusStateFile | null {
  const file = stateFilePath(workspace);
  if (!existsSync(file)) return null;
  try {
    return readBusStateFile(file);
  } catch {
    return null;
  }
}

async function runDaemonHere(config: BusConfig, supervisorPid: number | null): Promise<BusDaemonHandle> {
  const daemon = await startBusDaemon({
    logPath: defaultLogPath(config.workspace),
    port: config.port,
    authMode: config.authMode,
    registry: loadRegistry(config),
    maxLogBytes: config.maxLogBytes ?? undefined,
    maxLogArchives: config.maxLogArchives ?? undefined,
  });
  writeState(config.workspace, {
    format: "solvelang.bus.state",
    version: 1,
    workspace: config.workspace,
    supervisorPid,
    daemonPid: process.pid,
    port: daemon.port,
    logPath: defaultLogPath(config.workspace),
    authMode: config.authMode,
    startedAt: Date.now(),
  });
  console.log(`BUS_READY ${daemon.port} auth=${config.authMode}`);
  if (config.authMode === "local-open") {
    console.error(
      "solvelang-bus: auth mode local-open — messages are unsigned and carry no proof of sender. " +
        "Localhost development only; pass --keys <registry.json> for registry mode.",
    );
  }
  return daemon;
}

async function daemonChildMain(config: BusConfig): Promise<void> {
  const supervisorPid = Number(process.env.SOLVELANG_BUS_SUPERVISOR_PID ?? "") || null;
  const daemon = await runDaemonHere(config, supervisorPid);
  const shutdown = (): void => {
    void daemon.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await new Promise<void>(() => {});
}

async function superviseMain(config: BusConfig): Promise<void> {
  const selfPath = fileURLToPath(import.meta.url);
  let stopping = false;
  let child: ChildProcess | null = null;
  const restartTimes: number[] = [];

  const shutdown = (): void => {
    stopping = true;
    child?.kill("SIGTERM");
    // The daemon child removes nothing; the supervisor owns state.
    setTimeout(() => {
      try {
        rmSync(stateFilePath(config.workspace), { force: true });
      } catch {}
      process.exit(0);
    }, 300);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for (;;) {
    if (stopping) return;
    const startedAt = Date.now();
    child = spawn(process.execPath, [selfPath, "__daemon", ...configToArgv(config)], {
      cwd: config.workspace,
      env: { ...process.env, SOLVELANG_BUS_SUPERVISOR_PID: String(process.pid) },
      stdio: "inherit",
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child?.on("exit", (code) => resolve(code));
    });
    child = null;
    if (stopping) return;
    const survivedMs = Date.now() - startedAt;
    console.error(
      `solvelang-bus supervisor: daemon exited (code ${String(exitCode)}) after ${survivedMs}ms; restarting. ` +
        "Clients are on handoff-document fallback meanwhile — no state is lost.",
    );
    const at = Date.now();
    while (restartTimes.length > 0 && at - (restartTimes[0] as number) > RESTART_WINDOW_MS) restartTimes.shift();
    restartTimes.push(at);
    if (restartTimes.length > RESTART_LIMIT) {
      console.error(
        `solvelang-bus supervisor: daemon restarted ${RESTART_LIMIT} times inside ${RESTART_WINDOW_MS / 1_000}s; giving up. ` +
          "The bus is down; agents continue on handoff documents. Fix the cause (see the audit log) and run `solvelang-bus start` again.",
      );
      try {
        rmSync(stateFilePath(config.workspace), { force: true });
      } catch {}
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, RESTART_BACKOFF_MS));
  }
}

async function startMain(flags: Map<string, string>, switches: Set<string>): Promise<void> {
  const config = resolveConfig(flags);
  const existing = readStateIfPresent(config.workspace);
  if (existing && (pidAlive(existing.daemonPid) || pidAlive(existing.supervisorPid))) {
    console.log(JSON.stringify({ alreadyRunning: true, ...existing }));
    return;
  }
  if (switches.has("foreground")) {
    const daemon = await runDaemonHere(config, null);
    const shutdown = (): void => {
      void daemon.close().then(() => {
        try {
          rmSync(stateFilePath(config.workspace), { force: true });
        } catch {}
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    await new Promise<void>(() => {});
    return;
  }
  mkdirSync(busStateDir(config.workspace), { recursive: true });
  const logFd = openSync(supervisorLogPath(config.workspace), "a");
  const selfPath = fileURLToPath(import.meta.url);
  const supervisor = spawn(process.execPath, [selfPath, "__supervise", ...configToArgv(config)], {
    cwd: config.workspace,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  supervisor.unref();
  const deadline = Date.now() + 10_000;
  for (;;) {
    const state = readStateIfPresent(config.workspace);
    if (state && state.supervisorPid === supervisor.pid && pidAlive(state.daemonPid)) {
      console.log(JSON.stringify(state));
      return;
    }
    if (Date.now() > deadline) {
      throw new BusError(
        BUS_CODES.UNCONFIGURED,
        `bus daemon did not report ready within 10s; see ${supervisorLogPath(config.workspace)}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function stopMain(flags: Map<string, string>): Promise<void> {
  const workspace = resolveWorkspace(flags);
  const state = readStateIfPresent(workspace);
  if (!state) {
    console.log(JSON.stringify({ running: false }));
    return;
  }
  const targets = [state.supervisorPid, state.daemonPid].filter(
    (pid): pid is number => pid !== null && pidAlive(pid),
  );
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && targets.some((pid) => pidAlive(pid))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const pid of targets) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  try {
    rmSync(stateFilePath(workspace), { force: true });
  } catch {}
  console.log(JSON.stringify({ stopped: true, workspace }));
}

async function statusMain(flags: Map<string, string>): Promise<void> {
  const workspace = resolveWorkspace(flags);
  const state = readStateIfPresent(workspace);
  if (!state || (!pidAlive(state.daemonPid) && !pidAlive(state.supervisorPid))) {
    console.log(JSON.stringify({ running: false, workspace, ...(state ? { staleState: true } : {}) }));
    return;
  }
  const daemonStatus = await new Promise<Record<string, unknown> | null>((resolve) => {
    const socket = netConnect(state.port, "127.0.0.1");
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 2_000);
    socket.on("connect", () => socket.write(`${JSON.stringify({ op: "status", _seq: 1 })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const index = buffer.indexOf("\n");
      if (index >= 0) {
        clearTimeout(timer);
        socket.destroy();
        try {
          resolve(JSON.parse(buffer.slice(0, index)) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  console.log(JSON.stringify({ running: daemonStatus !== null, ...state, daemon: daemonStatus }));
}

async function main(): Promise<void> {
  const { command, flags, switches } = parseArgs(process.argv.slice(2));
  if (command === "start") return startMain(flags, switches);
  if (command === "stop") return stopMain(flags);
  if (command === "status") return statusMain(flags);
  if (command === "__supervise") return superviseMain(resolveConfig(flags));
  if (command === "__daemon") return daemonChildMain(resolveConfig(flags));
  console.error(
    "Usage: solvelang-bus <start|stop|status> [--workspace <dir>] [--port <n>] " +
      "[--keys <registry.json>] [--auth registry|local-open] [--max-log-bytes <n>] [--foreground]",
  );
  process.exit(2);
}

main().catch((error) => {
  console.error("SolveLang bus fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
