import type { ServerAuditSnapshot } from "./types";

export type ServerAuditScheduledJobRelationshipKind =
  | "scheduled-job-service"
  | "scheduled-job-process";

export type ServerAuditScheduledJobRelationship = {
  relationshipId: string;
  kind: ServerAuditScheduledJobRelationshipKind;
  jobIndex: number;
  jobSource: string;
  schedule?: string;
  targetName: string;
  targetIndex: number;
  confidence: "exact-name-token";
  evidence: {
    source: string;
    summary: string;
  };
};

export type ServerAuditScheduledJobRelationshipOptions = {
  maxJobs?: number;
  maxTargets?: number;
  maxRelationships?: number;
  maxCommandSummaryCharacters?: number;
};

export type ServerAuditScheduledJobRelationshipAnalysis = {
  schema: "solvelang.server-audit.scheduled-job-relationships.v0";
  mode: "analyze-only";
  status: "complete" | "partial";
  relationships: ServerAuditScheduledJobRelationship[];
  summary: {
    jobsObserved: number;
    jobsAnalyzed: number;
    serviceTargetsObserved: number;
    processTargetsObserved: number;
    relationshipsObserved: number;
    jobsWithRelationships: number;
    unresolvedJobs: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    commandExecution: false;
    maxJobs: number;
    maxTargets: number;
    maxRelationships: number;
    maxCommandSummaryCharacters: number;
    jobsTruncated: boolean;
    targetsTruncated: boolean;
    relationshipsTruncated: boolean;
    oversizedCommandSummariesSkipped: number;
  };
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srvrel_${hash.toString(16).padStart(8, "0")}`;
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function summaryTokens(summary: string): Set<string> {
  return new Set(
    normalize(summary)
      .split(/[^a-z0-9_.@-]+/)
      .map((value) => value.replace(/^[._@-]+|[._@-]+$/g, ""))
      .filter(Boolean),
  );
}

function serviceCandidateNames(name: string): string[] {
  const normalized = normalize(name);
  if (!normalized) return [];
  if (normalized.endsWith(".service") && normalized.length > ".service".length) {
    return [normalized, normalized.slice(0, -".service".length)];
  }
  return [normalized];
}

function exactTokenMatch(tokens: ReadonlySet<string>, names: readonly string[]): string | undefined {
  return names.find((name) => tokens.has(name));
}

function addTargetIndex(index: Map<string, number[]>, token: string, targetIndex: number): void {
  if (!token) return;
  const targets = index.get(token);
  if (targets) {
    targets.push(targetIndex);
  } else {
    index.set(token, [targetIndex]);
  }
}

function compareRelationship(
  left: ServerAuditScheduledJobRelationship,
  right: ServerAuditScheduledJobRelationship,
): number {
  return left.jobIndex - right.jobIndex
    || compareText(left.kind, right.kind)
    || compareText(left.targetName, right.targetName)
    || left.targetIndex - right.targetIndex
    || compareText(left.relationshipId, right.relationshipId);
}

export function analyzeServerAuditScheduledJobRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditScheduledJobRelationshipOptions = {},
): ServerAuditScheduledJobRelationshipAnalysis {
  const maxJobs = boundedInteger(options.maxJobs, 500, 1, 5_000, "Server Audit scheduled-job maxJobs");
  const maxTargets = boundedInteger(options.maxTargets, 2_000, 1, 20_000, "Server Audit scheduled-job maxTargets");
  const maxRelationships = boundedInteger(options.maxRelationships, 1_000, 1, 10_000, "Server Audit scheduled-job maxRelationships");
  const maxCommandSummaryCharacters = boundedInteger(
    options.maxCommandSummaryCharacters,
    512,
    1,
    4_096,
    "Server Audit scheduled-job maxCommandSummaryCharacters",
  );

  const jobs = snapshot.scheduledJobs ?? [];
  const services = snapshot.services ?? [];
  const processes = snapshot.processes ?? [];
  const boundedJobs = jobs.slice(0, maxJobs);
  const boundedServices = services.slice(0, maxTargets);
  const remainingTargetCapacity = Math.max(0, maxTargets - boundedServices.length);
  const boundedProcesses = processes.slice(0, remainingTargetCapacity);
  const targetsTruncated = services.length + processes.length > maxTargets;
  const serviceIndexesByToken = new Map<string, number[]>();
  const processIndexesByToken = new Map<string, number[]>();

  boundedServices.forEach((service, targetIndex) => {
    for (const candidate of serviceCandidateNames(service.name)) {
      addTargetIndex(serviceIndexesByToken, candidate, targetIndex);
    }
  });
  boundedProcesses.forEach((process, processIndex) => {
    addTargetIndex(processIndexesByToken, normalize(process.name), processIndex);
  });

  let oversizedCommandSummariesSkipped = 0;
  let relationshipsObserved = 0;
  let jobsWithRelationships = 0;
  const relationships: ServerAuditScheduledJobRelationship[] = [];

  boundedJobs.forEach((job, jobIndex) => {
    if (job.commandSummary.length > maxCommandSummaryCharacters) {
      oversizedCommandSummariesSkipped += 1;
      return;
    }
    const tokens = summaryTokens(job.commandSummary);
    if (tokens.size === 0) return;

    const matchedServiceIndexes = new Set<number>();
    const matchedProcessIndexes = new Set<number>();
    for (const token of tokens) {
      for (const targetIndex of serviceIndexesByToken.get(token) ?? []) {
        matchedServiceIndexes.add(targetIndex);
      }
      for (const processIndex of processIndexesByToken.get(token) ?? []) {
        matchedProcessIndexes.add(processIndex);
      }
    }

    const jobRelationshipCount = matchedServiceIndexes.size + matchedProcessIndexes.size;
    relationshipsObserved += jobRelationshipCount;
    if (jobRelationshipCount > 0) {
      jobsWithRelationships += 1;
    }

    const remainingRelationshipCapacity = Math.max(0, maxRelationships - relationships.length);
    if (remainingRelationshipCapacity === 0 || jobRelationshipCount === 0) return;
    const jobRelationships: ServerAuditScheduledJobRelationship[] = [];

    for (const targetIndex of matchedServiceIndexes) {
      const service = boundedServices[targetIndex];
      if (!service) continue;
      const matchedName = exactTokenMatch(tokens, serviceCandidateNames(service.name));
      if (!matchedName) continue;
      jobRelationships.push({
        relationshipId: stableId(["scheduled-job-service", String(jobIndex), String(targetIndex), normalize(service.name)]),
        kind: "scheduled-job-service",
        jobIndex,
        jobSource: job.source,
        ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
        targetName: service.name,
        targetIndex,
        confidence: "exact-name-token",
        evidence: {
          source: `scheduledJobs[${jobIndex}].commandSummary`,
          summary: `sanitized command summary contains the exact service-name token '${matchedName}'`,
        },
      });
    }

    for (const processIndex of matchedProcessIndexes) {
      const process = boundedProcesses[processIndex];
      if (!process) continue;
      const normalizedName = normalize(process.name);
      if (!normalizedName) continue;
      jobRelationships.push({
        relationshipId: stableId(["scheduled-job-process", String(jobIndex), String(processIndex), normalizedName]),
        kind: "scheduled-job-process",
        jobIndex,
        jobSource: job.source,
        ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
        targetName: process.name,
        targetIndex: processIndex,
        confidence: "exact-name-token",
        evidence: {
          source: `scheduledJobs[${jobIndex}].commandSummary`,
          summary: `sanitized command summary contains the exact process-name token '${normalizedName}'`,
        },
      });
    }

    jobRelationships.sort(compareRelationship);
    relationships.push(...jobRelationships.slice(0, remainingRelationshipCapacity));
  });

  relationships.sort(compareRelationship);
  const relationshipsTruncated = relationshipsObserved > maxRelationships;
  const jobsTruncated = jobs.length > maxJobs;
  const partial = jobsTruncated
    || targetsTruncated
    || relationshipsTruncated
    || oversizedCommandSummariesSkipped > 0;

  return {
    schema: "solvelang.server-audit.scheduled-job-relationships.v0",
    mode: "analyze-only",
    status: partial ? "partial" : "complete",
    relationships,
    summary: {
      jobsObserved: jobs.length,
      jobsAnalyzed: boundedJobs.length - oversizedCommandSummariesSkipped,
      serviceTargetsObserved: services.length,
      processTargetsObserved: processes.length,
      relationshipsObserved,
      jobsWithRelationships,
      unresolvedJobs: Math.max(0, boundedJobs.length - oversizedCommandSummariesSkipped - jobsWithRelationships),
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      commandExecution: false,
      maxJobs,
      maxTargets,
      maxRelationships,
      maxCommandSummaryCharacters,
      jobsTruncated,
      targetsTruncated,
      relationshipsTruncated,
      oversizedCommandSummariesSkipped,
    },
  };
}
