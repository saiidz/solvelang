import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const PUBLIC_BINDINGS = new Set(["0.0.0.0", "::", "*", "[::]"]);
const EXPECTED_PUBLIC_PORTS = new Set([80, 443]);
const SENSITIVE_PUBLIC_PORTS = new Map([
  [22, "SSH"],
  [21, "FTP"],
  [23, "Telnet"],
  [25, "SMTP"],
  [3306, "MySQL/MariaDB"],
  [5432, "PostgreSQL"],
  [6379, "Redis"],
  [27017, "MongoDB"],
  [9200, "Elasticsearch"],
  [11211, "Memcached"],
]);
const UNKNOWN_SECURITY_VALUES = new Set([
  "",
  "unknown",
  "unavailable",
  "not available",
  "n/a",
  "not applicable",
  "not-applicable",
  "not-collected",
  "not collected",
  "undetermined",
]);

function stableId(parts: string[]) {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function finding(
  severity: ServerAuditSeverity,
  category: string,
  title: string,
  summary: string,
  recommendation: string,
  evidence: ServerAuditFinding["evidence"],
): ServerAuditFinding {
  return { id: stableId([severity, category, title, ...evidence.map((item) => `${item.source}:${item.summary}`)]), severity, category, title, summary, recommendation, evidence };
}

function normalize(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isUnknownSecurityValue(value: string | undefined) {
  return UNKNOWN_SECURITY_VALUES.has(normalize(value));
}

function isYes(value: string | undefined) {
  return ["yes", "true", "enabled", "on", "active"].includes(normalize(value));
}

function sshLoginDisabled(value: string | undefined) {
  return normalize(value) === "no";
}

function firewallActive(value: string | undefined) {
  const normalized = normalize(value);
  return ["active", "enabled", "on", "running"].includes(normalized)
    || /^status:\s*active(?:\s|$)/.test(normalized);
}

function createSecurityProbeCoverageFinding(snapshot: ServerAuditSnapshot): ServerAuditFinding | undefined {
  if (!snapshot.security) return undefined;
  const probes: Array<[string, string | undefined]> = [
    ["security.firewall", snapshot.security.firewall],
    ["security.automaticUpdates", snapshot.security.automaticUpdates],
    ["security.rootSshLogin", snapshot.security.rootSshLogin],
    ["security.passwordSshLogin", snapshot.security.passwordSshLogin],
    ["security.selinux", snapshot.security.selinux],
    ["security.apparmor", snapshot.security.apparmor],
  ];
  const inconclusive = probes
    .filter(([, value]) => isUnknownSecurityValue(value))
    .map(([source]) => ({ source, summary: "value unavailable or unknown" }));
  if (inconclusive.length === 0) return undefined;
  return finding(
    "info",
    "coverage",
    "Security posture probes are inconclusive",
    `${inconclusive.length} supplied security posture probe(s) are missing or explicitly unknown, so those controls cannot be classified from this snapshot.`,
    "Re-collect the bounded security posture with the reviewed read-only collector before treating those controls as enabled, disabled, secure, or insecure.",
    inconclusive,
  );
}

export function analyzeServerSnapshot(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const findings: ServerAuditFinding[] = [];

  for (const filesystem of snapshot.filesystems ?? []) {
    if (filesystem.usagePercent === undefined) continue;
    if (filesystem.usagePercent >= 95) {
      findings.push(finding("critical", "storage", "Filesystem critically full", `${filesystem.mount} is ${filesystem.usagePercent}% used.`, "Free or expand storage immediately and confirm log/cache growth is controlled.", [{ source: filesystem.mount, summary: `${filesystem.usagePercent}% used` }]));
    } else if (filesystem.usagePercent >= 90) {
      findings.push(finding("high", "storage", "Filesystem nearly full", `${filesystem.mount} is ${filesystem.usagePercent}% used.`, "Investigate disk growth, rotate or archive safe data, and restore operational headroom.", [{ source: filesystem.mount, summary: `${filesystem.usagePercent}% used` }]));
    } else if (filesystem.usagePercent >= 80) {
      findings.push(finding("medium", "storage", "Filesystem usage elevated", `${filesystem.mount} is ${filesystem.usagePercent}% used.`, "Review growth sources and establish an alert before the filesystem reaches an operational threshold.", [{ source: filesystem.mount, summary: `${filesystem.usagePercent}% used` }]));
    }
  }

  for (const socket of snapshot.listeningSockets ?? []) {
    if (!PUBLIC_BINDINGS.has(socket.localAddress)) continue;
    const name = SENSITIVE_PUBLIC_PORTS.get(socket.port);
    if (name) {
      const severity: ServerAuditSeverity = socket.port === 23 || socket.port === 6379 || socket.port === 3306 || socket.port === 5432 ? "high" : "medium";
      findings.push(finding(severity, "network", `${name} listens on all interfaces`, `Port ${socket.port} is bound to ${socket.localAddress}${socket.process ? ` by ${socket.process}` : ""}.`, "Confirm this service must be internet/reachability exposed; otherwise bind it privately and enforce network-level filtering.", [{ source: `${socket.protocol}/${socket.port}`, summary: `binding ${socket.localAddress}` }]));
    } else if (!EXPECTED_PUBLIC_PORTS.has(socket.port)) {
      findings.push(finding("low", "network", "Unexpected public listener", `Port ${socket.port} is bound to all interfaces.`, "Confirm ownership and intended exposure, then restrict the listener or firewall if it is not required.", [{ source: `${socket.protocol}/${socket.port}`, summary: socket.process ?? "unknown process" }]));
    }
  }

  const securityProbeCoverage = createSecurityProbeCoverageFinding(snapshot);
  if (securityProbeCoverage) findings.push(securityProbeCoverage);

  if (snapshot.security?.rootSshLogin
    && !isUnknownSecurityValue(snapshot.security.rootSshLogin)
    && !sshLoginDisabled(snapshot.security.rootSshLogin)) {
    findings.push(finding("high", "ssh", "Root SSH login is not disabled", `Collected SSH posture reports root login as ${snapshot.security.rootSshLogin}.`, "Disable direct root SSH login after confirming a tested privileged-access alternative and recovery path.", [{ source: "sshd", summary: `PermitRootLogin=${snapshot.security.rootSshLogin}` }]));
  }

  if (snapshot.security?.passwordSshLogin
    && !isUnknownSecurityValue(snapshot.security.passwordSshLogin)
    && !sshLoginDisabled(snapshot.security.passwordSshLogin)) {
    findings.push(finding("medium", "ssh", "SSH password authentication remains enabled", `Collected SSH posture reports password login as ${snapshot.security.passwordSshLogin}.`, "Prefer key-based or centrally managed authentication after verifying operators will not be locked out.", [{ source: "sshd", summary: `PasswordAuthentication=${snapshot.security.passwordSshLogin}` }]));
  }

  const firewall = normalize(snapshot.security?.firewall);
  if (firewall
    && !isUnknownSecurityValue(snapshot.security?.firewall)
    && !firewallActive(snapshot.security?.firewall)) {
    findings.push(finding("high", "network", "Host firewall not reported active", `Firewall posture was reported as ${snapshot.security?.firewall}.`, "Verify the effective host/network firewall policy and enable an allowlist-based policy if the host is otherwise exposed.", [{ source: "firewall", summary: snapshot.security?.firewall ?? "unknown" }]));
  }

  if (snapshot.security?.automaticUpdates
    && !isUnknownSecurityValue(snapshot.security.automaticUpdates)
    && !isYes(snapshot.security.automaticUpdates)) {
    findings.push(finding("medium", "patching", "Automatic security updates not confirmed", `Automatic update posture was reported as ${snapshot.security.automaticUpdates}.`, "Define a tested patch cadence or enable controlled automatic security updates with maintenance and rollback procedures.", [{ source: "updates", summary: snapshot.security.automaticUpdates }]));
  }

  (snapshot.web?.certificates ?? []).forEach((certificate, index) => {
    if (certificate.daysRemaining === undefined) return;
    const source = `web.certificates[${index}].daysRemaining`;
    if (certificate.daysRemaining < 0) {
      findings.push(finding("critical", "tls", "TLS certificate expired", `Certificate evidence at web.certificates[${index}] reports expiry ${Math.abs(certificate.daysRemaining)} day(s) ago.`, "Replace or renew the certificate immediately and verify the served chain from the public endpoint.", [{ source, summary: `${certificate.daysRemaining} days remaining` }]));
    } else if (certificate.daysRemaining <= 7) {
      findings.push(finding("high", "tls", "TLS certificate expires within seven days", `Certificate evidence at web.certificates[${index}] has ${certificate.daysRemaining} day(s) remaining.`, "Renew now and verify automated renewal plus alerting.", [{ source, summary: `${certificate.daysRemaining} days remaining` }]));
    } else if (certificate.daysRemaining <= 30) {
      findings.push(finding("medium", "tls", "TLS certificate approaching expiry", `Certificate evidence at web.certificates[${index}] has ${certificate.daysRemaining} day(s) remaining.`, "Verify renewal automation and monitoring before the certificate enters the critical window.", [{ source, summary: `${certificate.daysRemaining} days remaining` }]));
    }
  });

  for (const root of snapshot.web?.roots ?? []) {
    if (root === undefined) continue;
    const mode = root.mode ?? "";
    if (/^[0-7]{3,4}$/.test(mode)) {
      const permissions = mode.slice(-3);
      if (["2", "3", "6", "7"].includes(permissions[2])) {
        findings.push(finding("high", "permissions", "Web root is world-writable", `${root.path} has mode ${mode}.`, "Remove world write permission after identifying which deployment/runtime user actually requires write access.", [{ source: root.path, summary: `mode ${mode}` }]));
      } else if (["2", "3", "6", "7"].includes(permissions[1])) {
        findings.push(finding("medium", "permissions", "Web root is group-writable", `${root.path} has mode ${mode}.`, "Confirm the owning group is intentionally constrained and reduce write scope if broad deployment groups are unnecessary.", [{ source: root.path, summary: `mode ${mode}` }]));
      }
    }
    if ((root.owner === "root" || root.owner === "0") && root.frameworkHints?.some((hint) => /laravel|node|next|wordpress/i.test(hint))) {
      findings.push(finding("low", "permissions", "Application web root owned by root", `${root.path} is owned by root.`, "Confirm deployment/runtime ownership is intentional; prefer a dedicated application owner where feasible.", [{ source: root.path, summary: "owner root" }]));
    }
  }

  if (snapshot.backups !== undefined) {
    if (snapshot.backups.length === 0) {
      findings.push(finding("high", "backup", "No backup evidence collected", "The snapshot contains an explicit empty backup inventory.", "Define and verify application/database backups, retention, encryption, and a restoration test rather than treating backup creation alone as sufficient.", [{ source: "backups", summary: "0 backup artifacts" }]));
    } else {
      const youngest = Math.min(...snapshot.backups.map((backup) => backup.ageHours ?? Number.POSITIVE_INFINITY));
      if (Number.isFinite(youngest) && youngest > 72) {
        findings.push(finding("medium", "backup", "Newest backup is older than 72 hours", `The youngest collected backup is about ${Math.round(youngest)} hours old.`, "Confirm the intended recovery point objective and repair the backup schedule if this age exceeds it.", [{ source: "backups", summary: `${Math.round(youngest)}h newest age` }]));
      }
    }
  }

  for (const log of snapshot.logs ?? []) {
    if ((log.sizeBytes ?? 0) >= 5 * 1024 * 1024 * 1024) {
      findings.push(finding("medium", "logging", "Very large log file", `${log.path} is at least 5 GiB.`, "Verify log rotation, retention, compression, and disk alerts before logs threaten application availability.", [{ source: log.path, summary: `${log.sizeBytes} bytes` }]));
    }
  }

  const failedServices = (snapshot.services ?? []).filter((service) => /failed|dead|inactive|error/i.test(service.state) && !/inactive \(dead\).*oneshot/i.test(service.state));
  for (const service of failedServices.slice(0, 50)) {
    findings.push(finding("medium", "service", "Service is not healthy", `${service.name} reports state ${service.state}.`, "Confirm whether the service is expected to run, then inspect its bounded service status/log evidence before restarting or changing it.", [{ source: service.name, summary: service.state }]));
  }

  if (snapshot.metadata?.redactionsApplied !== true) {
    findings.push(finding("medium", "privacy", "Collector redaction not confirmed", "The snapshot does not prove that sensitive values were redacted before export.", "Use the official read-only collector or another reviewed process that emits metadata.redactionsApplied=true and never exports secrets/private keys/customer contents.", [{ source: "metadata", summary: "redactionsApplied not true" }]));
  }

  if (!snapshot.security) {
    findings.push(finding("info", "coverage", "Security posture data not collected", "Firewall, SSH, MAC policy, and update posture are absent from this snapshot.", "Collect the missing read-only security posture before drawing a launch or hardening conclusion.", [{ source: "security", summary: "section absent" }]));
  }

  const order: Record<ServerAuditSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return findings.sort((left, right) => order[left.severity] - order[right.severity] || left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
}
