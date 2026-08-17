import type { ServerAuditSnapshot } from "./types";

export type ServerAuditInventorySection =
  | "filesystems"
  | "listeningSockets"
  | "processes"
  | "services"
  | "packages"
  | "scheduledJobs"
  | "webServers"
  | "webRoots"
  | "certificates"
  | "backups"
  | "logs";

export type ServerAuditInventorySummary = {
  schema: "solvelang.server-audit.inventory-summary.v0";
  mode: "analyze-only";
  sections: Array<{
    section: ServerAuditInventorySection;
    status: "collected" | "not-collected";
    count?: number;
  }>;
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
};

export function createServerAuditInventorySummary(snapshot: ServerAuditSnapshot): ServerAuditInventorySummary {
  const entries: Array<[ServerAuditInventorySection, readonly unknown[] | undefined]> = [
    ["filesystems", snapshot.filesystems],
    ["listeningSockets", snapshot.listeningSockets],
    ["processes", snapshot.processes],
    ["services", snapshot.services],
    ["packages", snapshot.packages],
    ["scheduledJobs", snapshot.scheduledJobs],
    ["webServers", snapshot.web?.servers],
    ["webRoots", snapshot.web?.roots],
    ["certificates", snapshot.web?.certificates],
    ["backups", snapshot.backups],
    ["logs", snapshot.logs],
  ];

  return {
    schema: "solvelang.server-audit.inventory-summary.v0",
    mode: "analyze-only",
    sections: entries.map(([section, evidence]) => evidence === undefined
      ? { section, status: "not-collected" as const }
      : { section, status: "collected" as const, count: evidence.length }),
    execution: {
      networkAccess: false,
      writeAccess: false,
    },
  };
}
