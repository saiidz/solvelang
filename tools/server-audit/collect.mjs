#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const COLLECTOR_VERSION = "0.4.0";
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_ITEMS = 5000;
const PUBLIC_FILE_MARKERS = [
  [".env", "env-file"],
  [".git/config", "git-config"],
  [".npmrc", "npmrc"],
  ["auth.json", "composer-auth"],
];

function command(program, args = []) {
  try {
    return execFileSync(program, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      maxBuffer: MAX_OUTPUT,
      env: { PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" },
    }).trim();
  } catch {
    return "";
  }
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeStat(path) {
  try { return statSync(path); } catch { return undefined; }
}

function listDir(path, max = 500) {
  try { return readdirSync(path, { withFileTypes: true }).slice(0, max); } catch { return []; }
}

function osRelease() {
  try {
    const values = {};
    for (const line of readFileSync("/etc/os-release", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^['"]|['"]$/g, "").replace(/\\([\\"'$`])/g, "$1");
    }
    return [values.NAME, values.VERSION_ID].filter(Boolean).join(" ").slice(0, 500);
  } catch {
    return "";
  }
}

function collectFilesystems() {
  const output = command("df", ["-P", "-B1"]);
  if (!output) return [];
  return output.split("\n").slice(1, MAX_ITEMS + 1).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) return [];
    const [filesystem, size, used, available, percent, ...mountParts] = fields;
    const usagePercent = numeric(percent.replace("%", ""));
    return [{
      mount: mountParts.join(" "),
      filesystem,
      sizeBytes: numeric(size),
      usedBytes: numeric(used),
      availableBytes: numeric(available),
      usagePercent,
    }];
  });
}

function collectSockets() {
  const output = command("ss", ["-H", "-lntup"]);
  if (!output) return [];
  return output.split("\n").slice(0, MAX_ITEMS).flatMap((line) => {
    const match = line.match(/^(tcp|udp)\S*\s+\S+\s+\S+\s+\S+\s+([^\s]+)(?:\s+[^\s]+)?(?:\s+users:\(\(\"([^\"]+)/)?/i);
    if (!match) return [];
    const endpoint = match[2];
    const bracket = endpoint.match(/^\[([^\]]+)\]:(\d+)$/);
    const plain = endpoint.match(/^(.*):(\d+)$/);
    const address = bracket?.[1] ?? plain?.[1];
    const port = Number(bracket?.[2] ?? plain?.[2]);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return [];
    return [{ protocol: match[1].toLowerCase(), localAddress: address, port, process: match[3] || undefined }];
  });
}

function collectProcesses() {
  const output = command("ps", ["-eo", "pid=,ppid=,uid=,stat=,comm="]);
  if (!output) return [];
  return output.split("\n").slice(0, MAX_ITEMS).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const uid = Number(match[3]);
    const state = match[4].slice(0, 32);
    const name = match[5].trim().slice(0, 200);
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 4_194_304) return [];
    if (!Number.isSafeInteger(ppid) || ppid < 0 || ppid > 4_194_304) return [];
    if (!Number.isSafeInteger(uid) || uid < 0 || uid > 4_294_967_295) return [];
    if (!state || !name) return [];
    return [{ pid, ppid, uid, state, name }];
  });
}

function collectServiceEnablement() {
  const output = command("systemctl", ["list-unit-files", "--type=service", "--no-legend", "--no-pager"]);
  if (!output) return new Map();
  return new Map(output.split("\n").slice(0, MAX_ITEMS).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2 || !fields[0] || !fields[1]) return [];
    return [[fields[0], fields[1].slice(0, 100)]];
  }));
}

function collectServices() {
  const enablementByName = collectServiceEnablement();
  const output = command("systemctl", ["list-units", "--type=service", "--all", "--no-legend", "--no-pager"]);
  if (!output) return [];
  return output.split("\n").slice(0, 1000).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) return [];
    return [{ name: fields[0], state: `${fields[2]} ${fields[3]}`, enabled: enablementByName.get(fields[0]) }];
  });
}

function collectPackages() {
  const dpkg = command("dpkg-query", ["-W", "-f=${Package}\t${Version}\n"]);
  if (dpkg) return dpkg.split("\n").slice(0, MAX_ITEMS).flatMap((line) => {
    const [name, version] = line.split("\t");
    return name && version ? [{ name, version }] : [];
  });
  const rpm = command("rpm", ["-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"]);
  return rpm.split("\n").slice(0, MAX_ITEMS).flatMap((line) => {
    const [name, version] = line.split("\t");
    return name && version ? [{ name, version }] : [];
  });
}

function collectCronEvidence() {
  const jobs = [];
  for (const directory of ["/etc/cron.d", "/etc/cron.daily", "/etc/cron.hourly", "/etc/cron.weekly", "/etc/cron.monthly"]) {
    for (const entry of listDir(directory, 200)) {
      if (jobs.length >= 1000) break;
      if (!entry.name.startsWith(".")) jobs.push({ source: join(directory, entry.name), commandSummary: "command content intentionally not collected" });
    }
  }
  return jobs;
}

function detectFrameworks(path) {
  const hints = [];
  const checks = [
    ["artisan", "Laravel"], ["wp-config.php", "WordPress"], ["package.json", "Node.js"], ["next.config.js", "Next.js"],
    ["next.config.ts", "Next.js"], ["composer.json", "PHP/Composer"], ["manage.py", "Django"], ["Gemfile", "Ruby"],
  ];
  for (const [file, hint] of checks) if (existsSync(join(path, file)) && !hints.includes(hint)) hints.push(hint);
  return hints;
}

function modeOf(stat) {
  return (stat.mode & 0o7777).toString(8).padStart(3, "0");
}

function collectWebRoots() {
  const roots = [];
  const candidates = [];
  for (const base of ["/var/www", "/srv/www"]) {
    if (!existsSync(base)) continue;
    for (const entry of listDir(base, 200)) if (entry.isDirectory()) candidates.push(join(base, entry.name));
  }
  if (existsSync("/home")) {
    for (const home of listDir("/home", 300)) {
      if (!home.isDirectory()) continue;
      const publicHtml = join("/home", home.name, "public_html");
      if (existsSync(publicHtml)) candidates.push(publicHtml);
    }
  }
  for (const path of candidates.slice(0, 500)) {
    const stat = safeStat(path);
    if (!stat) continue;
    roots.push({ path, owner: String(stat.uid), mode: modeOf(stat), frameworkHints: detectFrameworks(path) });
  }
  return roots;
}

function collectPublicFileChecks(roots) {
  const checks = [];
  roots.forEach((root, rootIndex) => {
    for (const [relativePath, marker] of PUBLIC_FILE_MARKERS) {
      checks.push({ rootIndex, marker, present: existsSync(join(root.path, relativePath)) });
    }
  });
  return checks.slice(0, 2000);
}

function collectCertificates() {
  const results = [];
  const now = Date.now();
  const live = "/etc/letsencrypt/live";
  for (const entry of listDir(live, 300)) {
    if (!entry.isDirectory()) continue;
    const cert = join(live, entry.name, "cert.pem");
    if (!existsSync(cert)) continue;
    const endDate = command("openssl", ["x509", "-in", cert, "-noout", "-enddate"]);
    const raw = endDate.replace(/^notAfter=/, "").trim();
    const timestamp = Date.parse(raw);
    results.push({
      name: entry.name,
      notAfter: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined,
      daysRemaining: Number.isFinite(timestamp) ? Math.floor((timestamp - now) / 86_400_000) : undefined,
    });
  }
  return results;
}

function collectBackups() {
  const results = [];
  const now = Date.now();
  for (const base of ["/backup", "/backups", "/var/backups"]) {
    for (const entry of listDir(base, 500)) {
      if (results.length >= 1000) break;
      const path = join(base, entry.name);
      const stat = safeStat(path);
      if (!stat) continue;
      results.push({ name: entry.name, path, ageHours: Math.max(0, (now - stat.mtimeMs) / 3_600_000), sizeBytes: stat.isFile() ? stat.size : undefined });
    }
  }
  return results;
}

function collectLogs() {
  const results = [];
  for (const base of ["/var/log"]) {
    for (const entry of listDir(base, 1000)) {
      if (!entry.isFile()) continue;
      const path = join(base, entry.name);
      const stat = safeStat(path);
      if (!stat) continue;
      results.push({ path, sizeBytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() });
    }
  }
  return results;
}

function firstMatch(path, setting) {
  if (!existsSync(path)) return undefined;
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/#.*/, "").trim();
      const match = clean.match(new RegExp(`^${setting}\\s+(.+)$`, "i"));
      if (match) return match[1].trim();
    }
  } catch {}
  return undefined;
}

function collectSecurity() {
  const ufw = command("ufw", ["status"]);
  const firewallCmd = command("firewall-cmd", ["--state"]);
  const firewall = ufw ? ufw.split("\n")[0] : firewallCmd || "unknown";
  const selinux = command("getenforce", []) || undefined;
  const apparmor = command("aa-status", ["--enabled"]) ? "enabled" : existsSync("/sys/module/apparmor") ? "present" : "unknown";
  const unattended = command("systemctl", ["is-enabled", "unattended-upgrades.service"]);
  return {
    firewall,
    selinux,
    apparmor,
    automaticUpdates: unattended || "unknown",
    rootSshLogin: firstMatch("/etc/ssh/sshd_config", "PermitRootLogin") || "unknown",
    passwordSshLogin: firstMatch("/etc/ssh/sshd_config", "PasswordAuthentication") || "unknown",
  };
}

const webRoots = collectWebRoots();
const snapshot = {
  schemaVersion: "1",
  collectedAt: new Date().toISOString(),
  host: {
    hostname: os.hostname().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 253) || "unknown-host",
    os: osRelease() || os.type(),
    kernel: os.release(),
    architecture: os.arch(),
  },
  system: {
    uptimeSeconds: os.uptime(),
    load: os.loadavg(),
    memoryTotalBytes: os.totalmem(),
    memoryAvailableBytes: os.freemem(),
  },
  filesystems: collectFilesystems(),
  listeningSockets: collectSockets(),
  processes: collectProcesses(),
  services: collectServices(),
  packages: collectPackages(),
  scheduledJobs: collectCronEvidence(),
  web: {
    servers: ["nginx", "apache2", "httpd", "caddy"].filter((name) => command("systemctl", ["is-active", name]) === "active"),
    roots: webRoots,
    certificates: collectCertificates(),
    publicFileChecks: collectPublicFileChecks(webRoots),
  },
  backups: collectBackups(),
  logs: collectLogs(),
  security: collectSecurity(),
  metadata: {
    collectorVersion: COLLECTOR_VERSION,
    redactionsApplied: true,
    notes: [
      "Collector runs a fixed read-only command allowlist and accepts no command arguments from user input.",
      "Process inventory contains PID, parent PID, numeric uid, state, and executable comm name only; arguments, command lines, and environment variables are not collected.",
      "Service inventory combines fixed read-only systemctl runtime and unit-file enablement listings; unmatched units retain unknown enablement evidence.",
      "Sensitive public-file checks record only existence booleans for four fixed marker paths under candidate web roots; file contents are never read.",
      "Environment variables, file contents, database contents, private keys, credentials, process command lines, and cron command bodies are not collected.",
      "Web-root ownership is emitted as numeric uid to avoid unrelated account-directory metadata.",
    ],
  },
};

process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
