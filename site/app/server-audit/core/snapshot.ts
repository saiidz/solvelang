import type { ServerAuditPublicFileMarker, ServerAuditSnapshot } from "./types";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_COLLECTION = 5000;
const SAFE_HOST = /^[A-Za-z0-9._-]{1,253}$/;
const PUBLIC_FILE_MARKERS = new Set<ServerAuditPublicFileMarker>(["env-file", "git-config", "npmrc", "composer-auth"]);

function array<T>(value: unknown, name: string, max = MAX_COLLECTION): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} is invalid or too large.`);
  return value as T[];
}

function text(value: unknown, name: string, max = 1000, optional = true) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length > max) throw new Error(`${name} is invalid.`);
  if ([...value].some((character) => character.charCodeAt(0) < 9 || (character.charCodeAt(0) > 13 && character.charCodeAt(0) < 32))) {
    throw new Error(`${name} contains control characters.`);
  }
  return value;
}

function number(value: unknown, name: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} is invalid.`);
  return value;
}

function integer(value: unknown, name: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = number(value, name, { min, max });
  if (parsed === undefined) return undefined;
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is invalid.`);
  return parsed;
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is invalid.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${name} has an unsafe object shape.`);
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`${name} has an unsafe key.`);
  }
}

function knownKeys(value: Record<string, unknown>, allowed: string[], name: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${name} contains unknown field ${unexpected[0]}.`);
}

export function parseServerAuditSnapshot(raw: string): ServerAuditSnapshot {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot is too large.");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error("Snapshot is not valid JSON."); }
  assertObject(input, "Snapshot");
  knownKeys(input, ["schemaVersion","collectedAt","host","system","filesystems","listeningSockets","processes","services","packages","scheduledJobs","web","backups","logs","security","metadata"], "Snapshot");
  if (input.schemaVersion !== "1") throw new Error("Unsupported snapshot schema version.");
  const collectedAt = text(input.collectedAt, "collectedAt", 40, false)!;
  if (!Number.isFinite(Date.parse(collectedAt))) throw new Error("collectedAt is invalid.");

  assertObject(input.host, "host");
  knownKeys(input.host, ["hostname","os","kernel","architecture"], "host");
  const hostname = text(input.host.hostname, "hostname", 253, false)!;
  if (!SAFE_HOST.test(hostname)) throw new Error("hostname is invalid.");

  const snapshot: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: new Date(Date.parse(collectedAt)).toISOString(),
    host: {
      hostname,
      os: text(input.host.os, "host.os", 500),
      kernel: text(input.host.kernel, "host.kernel", 300),
      architecture: text(input.host.architecture, "host.architecture", 100),
    },
  };

  if (input.system !== undefined) {
    assertObject(input.system, "system");
    knownKeys(input.system, ["uptimeSeconds","load","memoryTotalBytes","memoryAvailableBytes"], "system");
    const load = array<number>(input.system.load, "system.load", 3);
    if (load?.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 1_000_000)) throw new Error("system.load is invalid.");
    snapshot.system = {
      uptimeSeconds: number(input.system.uptimeSeconds, "system.uptimeSeconds"),
      load,
      memoryTotalBytes: number(input.system.memoryTotalBytes, "system.memoryTotalBytes"),
      memoryAvailableBytes: number(input.system.memoryAvailableBytes, "system.memoryAvailableBytes"),
    };
  }

  const filesystems = array<Record<string, unknown>>(input.filesystems, "filesystems");
  if (filesystems) snapshot.filesystems = filesystems.map((entry, index) => {
    assertObject(entry, `filesystems[${index}]`);
    knownKeys(entry, ["mount","filesystem","sizeBytes","usedBytes","availableBytes","usagePercent"], `filesystems[${index}]`);
    return {
      mount: text(entry.mount, `filesystems[${index}].mount`, 500, false)!,
      filesystem: text(entry.filesystem, `filesystems[${index}].filesystem`, 100),
      sizeBytes: number(entry.sizeBytes, `filesystems[${index}].sizeBytes`),
      usedBytes: number(entry.usedBytes, `filesystems[${index}].usedBytes`),
      availableBytes: number(entry.availableBytes, `filesystems[${index}].availableBytes`),
      usagePercent: number(entry.usagePercent, `filesystems[${index}].usagePercent`, { min: 0, max: 100 }),
    };
  });

  const sockets = array<Record<string, unknown>>(input.listeningSockets, "listeningSockets");
  if (sockets) snapshot.listeningSockets = sockets.map((entry, index) => {
    assertObject(entry, `listeningSockets[${index}]`);
    knownKeys(entry, ["protocol","localAddress","port","process"], `listeningSockets[${index}]`);
    return {
      protocol: text(entry.protocol, `listeningSockets[${index}].protocol`, 20, false)!,
      localAddress: text(entry.localAddress, `listeningSockets[${index}].localAddress`, 100, false)!,
      port: number(entry.port, `listeningSockets[${index}].port`, { min: 1, max: 65535 })!,
      process: text(entry.process, `listeningSockets[${index}].process`, 200),
    };
  });

  const processes = array<Record<string, unknown>>(input.processes, "processes");
  if (processes) snapshot.processes = processes.map((entry, index) => {
    assertObject(entry, `processes[${index}]`);
    knownKeys(entry, ["pid","ppid","uid","state","name"], `processes[${index}]`);
    return {
      pid: integer(entry.pid, `processes[${index}].pid`, { min: 1, max: 4_194_304 })!,
      ppid: integer(entry.ppid, `processes[${index}].ppid`, { min: 0, max: 4_194_304 })!,
      uid: integer(entry.uid, `processes[${index}].uid`, { min: 0, max: 4_294_967_295 })!,
      state: text(entry.state, `processes[${index}].state`, 32, false)!,
      name: text(entry.name, `processes[${index}].name`, 200, false)!,
    };
  });

  const services = array<Record<string, unknown>>(input.services, "services");
  if (services) snapshot.services = services.map((entry, index) => {
    assertObject(entry, `services[${index}]`);
    knownKeys(entry, ["name","state","enabled"], `services[${index}]`);
    return {
      name: text(entry.name, `services[${index}].name`, 200, false)!,
      state: text(entry.state, `services[${index}].state`, 100, false)!,
      enabled: text(entry.enabled, `services[${index}].enabled`, 100),
    };
  });

  const packages = array<Record<string, unknown>>(input.packages, "packages");
  if (packages) snapshot.packages = packages.map((entry, index) => {
    assertObject(entry, `packages[${index}]`);
    knownKeys(entry, ["name","version"], `packages[${index}]`);
    return {
      name: text(entry.name, `packages[${index}].name`, 200, false)!,
      version: text(entry.version, `packages[${index}].version`, 200, false)!,
    };
  });

  const jobs = array<Record<string, unknown>>(input.scheduledJobs, "scheduledJobs");
  if (jobs) snapshot.scheduledJobs = jobs.map((entry, index) => {
    assertObject(entry, `scheduledJobs[${index}]`);
    knownKeys(entry, ["source","schedule","commandSummary"], `scheduledJobs[${index}]`);
    return {
      source: text(entry.source, `scheduledJobs[${index}].source`, 300, false)!,
      schedule: text(entry.schedule, `scheduledJobs[${index}].schedule`, 100),
      commandSummary: text(entry.commandSummary, `scheduledJobs[${index}].commandSummary`, 500, false)!,
    };
  });

  if (input.web !== undefined) {
    assertObject(input.web, "web");
    knownKeys(input.web, ["servers","roots","certificates","publicFileChecks"], "web");
    const servers = array<unknown>(input.web.servers, "web.servers", 50)?.map((entry, index) => text(entry, `web.servers[${index}]`, 100, false)!);
    const roots = array<Record<string, unknown>>(input.web.roots, "web.roots", 500)?.map((entry, index) => {
      assertObject(entry, `web.roots[${index}]`);
      knownKeys(entry, ["path","owner","mode","frameworkHints"], `web.roots[${index}]`);
      return {
        path: text(entry.path, `web.roots[${index}].path`, 500, false)!,
        owner: text(entry.owner, `web.roots[${index}].owner`, 100),
        mode: text(entry.mode, `web.roots[${index}].mode`, 20),
        frameworkHints: array<unknown>(entry.frameworkHints, `web.roots[${index}].frameworkHints`, 30)?.map((hint, hintIndex) => text(hint, `frameworkHints[${hintIndex}]`, 100, false)!),
      };
    });
    const certificates = array<Record<string, unknown>>(input.web.certificates, "web.certificates", 500)?.map((entry, index) => {
      assertObject(entry, `web.certificates[${index}]`);
      knownKeys(entry, ["name","notAfter","daysRemaining"], `web.certificates[${index}]`);
      return {
        name: text(entry.name, `web.certificates[${index}].name`, 300, false)!,
        notAfter: text(entry.notAfter, `web.certificates[${index}].notAfter`, 100),
        daysRemaining: number(entry.daysRemaining, `web.certificates[${index}].daysRemaining`, { min: -10000, max: 10000 }),
      };
    });
    const publicFileChecks = array<Record<string, unknown>>(input.web.publicFileChecks, "web.publicFileChecks", 2000)?.map((entry, index) => {
      assertObject(entry, `web.publicFileChecks[${index}]`);
      knownKeys(entry, ["rootIndex","marker","present"], `web.publicFileChecks[${index}]`);
      const rootIndex = integer(entry.rootIndex, `web.publicFileChecks[${index}].rootIndex`, { min: 0, max: 499 })!;
      const marker = text(entry.marker, `web.publicFileChecks[${index}].marker`, 50, false)! as ServerAuditPublicFileMarker;
      if (!PUBLIC_FILE_MARKERS.has(marker)) throw new Error(`web.publicFileChecks[${index}].marker is invalid.`);
      if (typeof entry.present !== "boolean") throw new Error(`web.publicFileChecks[${index}].present is invalid.`);
      if (!roots || rootIndex >= roots.length) throw new Error(`web.publicFileChecks[${index}].rootIndex is invalid.`);
      return { rootIndex, marker, present: entry.present };
    });
    snapshot.web = { servers, roots, certificates, publicFileChecks };
  }

  const backups = array<Record<string, unknown>>(input.backups, "backups", 1000);
  if (backups) snapshot.backups = backups.map((entry, index) => {
    assertObject(entry, `backups[${index}]`);
    knownKeys(entry, ["name","path","ageHours","sizeBytes"], `backups[${index}]`);
    return {
      name: text(entry.name, `backups[${index}].name`, 200, false)!,
      path: text(entry.path, `backups[${index}].path`, 500),
      ageHours: number(entry.ageHours, `backups[${index}].ageHours`),
      sizeBytes: number(entry.sizeBytes, `backups[${index}].sizeBytes`),
    };
  });

  const logs = array<Record<string, unknown>>(input.logs, "logs", 1000);
  if (logs) snapshot.logs = logs.map((entry, index) => {
    assertObject(entry, `logs[${index}]`);
    knownKeys(entry, ["path","sizeBytes","modifiedAt"], `logs[${index}]`);
    return {
      path: text(entry.path, `logs[${index}].path`, 500, false)!,
      sizeBytes: number(entry.sizeBytes, `logs[${index}].sizeBytes`),
      modifiedAt: text(entry.modifiedAt, `logs[${index}].modifiedAt`, 100),
    };
  });

  if (input.security !== undefined) {
    assertObject(input.security, "security");
    knownKeys(input.security, ["firewall","selinux","apparmor","automaticUpdates","rootSshLogin","passwordSshLogin"], "security");
    snapshot.security = Object.fromEntries(Object.entries(input.security).map(([key, value]) => [key, text(value, `security.${key}`, 100)])) as ServerAuditSnapshot["security"];
  }

  if (input.metadata !== undefined) {
    assertObject(input.metadata, "metadata");
    knownKeys(input.metadata, ["collectorVersion","redactionsApplied","notes"], "metadata");
    if (input.metadata.redactionsApplied !== undefined && typeof input.metadata.redactionsApplied !== "boolean") throw new Error("metadata.redactionsApplied is invalid.");
    snapshot.metadata = {
      collectorVersion: text(input.metadata.collectorVersion, "metadata.collectorVersion", 100),
      redactionsApplied: input.metadata.redactionsApplied as boolean | undefined,
      notes: array<unknown>(input.metadata.notes, "metadata.notes", 100)?.map((entry, index) => text(entry, `metadata.notes[${index}]`, 500, false)!),
    };
  }

  return snapshot;
}