export type ServerAuditSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ServerAuditEvidence = {
  source: string;
  summary: string;
};

export type ServerAuditFinding = {
  id: string;
  severity: ServerAuditSeverity;
  category: string;
  title: string;
  summary: string;
  recommendation: string;
  evidence: ServerAuditEvidence[];
};

export type ServerAuditSnapshot = {
  schemaVersion: "1";
  collectedAt: string;
  host: {
    hostname: string;
    os?: string;
    kernel?: string;
    architecture?: string;
  };
  system?: {
    uptimeSeconds?: number;
    load?: number[];
    memoryTotalBytes?: number;
    memoryAvailableBytes?: number;
  };
  filesystems?: Array<{
    mount: string;
    filesystem?: string;
    sizeBytes?: number;
    usedBytes?: number;
    availableBytes?: number;
    usagePercent?: number;
  }>;
  listeningSockets?: Array<{
    protocol: string;
    localAddress: string;
    port: number;
    process?: string;
  }>;
  services?: Array<{
    name: string;
    state: string;
    enabled?: string;
  }>;
  packages?: Array<{
    name: string;
    version: string;
  }>;
  scheduledJobs?: Array<{
    source: string;
    schedule?: string;
    commandSummary: string;
  }>;
  web?: {
    servers?: string[];
    roots?: Array<{
      path: string;
      owner?: string;
      mode?: string;
      frameworkHints?: string[];
    }>;
    certificates?: Array<{
      name: string;
      notAfter?: string;
      daysRemaining?: number;
    }>;
  };
  backups?: Array<{
    name: string;
    path?: string;
    ageHours?: number;
    sizeBytes?: number;
  }>;
  logs?: Array<{
    path: string;
    sizeBytes?: number;
    modifiedAt?: string;
  }>;
  security?: {
    firewall?: string;
    selinux?: string;
    apparmor?: string;
    automaticUpdates?: string;
    rootSshLogin?: string;
    passwordSshLogin?: string;
  };
  metadata?: {
    collectorVersion?: string;
    redactionsApplied?: boolean;
    notes?: string[];
  };
};

export type ServerAuditReport = {
  schemaVersion: "1";
  reportId: string;
  snapshotCollectedAt: string;
  generatedAt: string;
  host: ServerAuditSnapshot["host"];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    score: number;
  };
  findings: ServerAuditFinding[];
  limitations: string[];
};
