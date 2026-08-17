import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const MAX_COVERAGE_EVIDENCE = 16;

function stableId(parts: string[]) {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

type CoverageProbe = {
  source: string;
  present: boolean;
};

export function createServerAuditCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const probes: CoverageProbe[] = [
    { source: "system", present: snapshot.system !== undefined },
    { source: "filesystems", present: snapshot.filesystems !== undefined },
    { source: "listeningSockets", present: snapshot.listeningSockets !== undefined },
    { source: "processes", present: snapshot.processes !== undefined },
    { source: "services", present: snapshot.services !== undefined },
    { source: "packages", present: snapshot.packages !== undefined },
    { source: "scheduledJobs", present: snapshot.scheduledJobs !== undefined },
    { source: "web.servers", present: snapshot.web?.servers !== undefined },
    { source: "web.roots", present: snapshot.web?.roots !== undefined },
    { source: "web.certificates", present: snapshot.web?.certificates !== undefined },
    { source: "web.publicFileChecks", present: snapshot.web?.publicFileChecks !== undefined },
    { source: "backups", present: snapshot.backups !== undefined },
    { source: "logs", present: snapshot.logs !== undefined },
    { source: "security", present: snapshot.security !== undefined },
  ];

  const missing = probes.filter((probe) => !probe.present).slice(0, MAX_COVERAGE_EVIDENCE);
  if (missing.length === 0) return [];

  const evidence = missing.map((probe) => ({
    source: `snapshot.${probe.source}`,
    summary: "section absent",
  }));
  const title = "Read-only snapshot coverage is incomplete";
  const category = "coverage";
  const severity = "info" as const;

  return [{
    id: stableId([severity, category, title, ...evidence.map((item) => item.source)]),
    severity,
    category,
    title,
    summary: `${missing.length} expected read-only evidence section(s) were not supplied, so related posture conclusions must remain unknown.`,
    recommendation: "Collect the missing sections with the reviewed read-only collector before treating absence of findings as evidence of a healthy server.",
    evidence,
  }];
}