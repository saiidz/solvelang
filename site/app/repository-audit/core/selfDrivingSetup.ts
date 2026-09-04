import type { RepositoryDetection, RepositoryInventoryAnalysis } from "./inventory";
import type { SelfDrivingMode, SolveScoutKind } from "./selfDriving";

export type SetupContextAdapter =
  | "runtime-events"
  | "error-traces"
  | "logs"
  | "deployment-health"
  | "feature-flags"
  | "experiments"
  | "support-context"
  | "ai-traces"
  | "mcp-tool-calls"
  | "cost-signals"
  | "generic-runtime-signals";

export type SetupPlanStep = {
  id: string;
  status: "available-now" | "planned";
  kind: "review-repository-evidence" | "review-context-adapter";
  title: string;
  explanation: string;
  adapter?: SetupContextAdapter;
  scouts: SolveScoutKind[];
  evidence: Array<{
    name: string;
    version?: string;
    confidenceScore: number;
  }>;
};

export type SelfDrivingSetupPlan = {
  schema: "solvelang.self-driving.setup-plan.v0";
  mode: "analyze-only";
  source: RepositoryInventoryAnalysis["source"];
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    planOnly: true;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
    emitsCommands: false;
    handlesCredentials: false;
  };
  detected: {
    frameworks: Array<{ name: string; version?: string; confidenceScore: number }>;
    languages: Array<{ name: string; version?: string; confidenceScore: number }>;
    packageManagers: Array<{ name: string; version?: string; confidenceScore: number }>;
    deploymentTargets: Array<{ name: string; version?: string; confidenceScore: number }>;
  };
  limits: {
    maxDetectionsPerGroup: number;
    maxSteps: number;
  };
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: Array<"framework-count" | "language-count" | "package-manager-count" | "deployment-target-count" | "step-count">;
  };
  steps: SetupPlanStep[];
};

export type SelfDrivingSetupOptions = {
  requestedMode?: SelfDrivingMode;
  maxDetectionsPerGroup?: number;
  maxSteps?: number;
};

const defaults = Object.freeze({
  maxDetectionsPerGroup: 32,
  maxSteps: 32,
});

const frameworkCatalog: Record<string, { adapters: SetupContextAdapter[]; scouts: SolveScoutKind[] }> = {
  "Next.js": {
    adapters: ["runtime-events", "error-traces", "deployment-health"],
    scouts: ["experience", "incident", "rollout"],
  },
  React: {
    adapters: ["runtime-events", "error-traces"],
    scouts: ["experience", "incident"],
  },
  Vue: {
    adapters: ["runtime-events", "error-traces"],
    scouts: ["experience", "incident"],
  },
  Svelte: {
    adapters: ["runtime-events", "error-traces"],
    scouts: ["experience", "incident"],
  },
  Angular: {
    adapters: ["runtime-events", "error-traces", "deployment-health"],
    scouts: ["experience", "incident", "rollout"],
  },
  Express: {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
  Fastify: {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
  Laravel: {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
  Django: {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
  "Rust/Cargo": {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
  "Go modules": {
    adapters: ["error-traces", "logs", "deployment-health"],
    scouts: ["incident", "rollout"],
  },
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul((left ^ code) >>> 0, 0x01000193) >>> 0;
    right = Math.imul((right ^ ((code + index) >>> 0)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

function detectionSummary(item: RepositoryDetection): { name: string; version?: string; confidenceScore: number } {
  return {
    name: item.name,
    ...(item.version === undefined ? {} : { version: item.version }),
    confidenceScore: item.confidence.score,
  };
}

function boundedDetections(
  items: RepositoryDetection[],
  limit: number,
  reason: SelfDrivingSetupPlan["execution"]["truncationReasons"][number],
  reasons: Set<SelfDrivingSetupPlan["execution"]["truncationReasons"][number]>,
): RepositoryDetection[] {
  const sorted = [...items].sort((left, right) => compareText(left.name, right.name) || compareText(left.version ?? "", right.version ?? ""));
  if (sorted.length > limit) reasons.add(reason);
  return sorted.slice(0, limit);
}

function dedupeScouts(items: SolveScoutKind[]): SolveScoutKind[] {
  return [...new Set(items)].sort(compareText);
}

function makeStep(
  status: SetupPlanStep["status"],
  kind: SetupPlanStep["kind"],
  title: string,
  explanation: string,
  scouts: SolveScoutKind[],
  evidence: RepositoryDetection[],
  adapter?: SetupContextAdapter,
): SetupPlanStep {
  const normalizedEvidence = evidence.map(detectionSummary).sort((left, right) => compareText(left.name, right.name));
  const identity = JSON.stringify({ status, kind, title, adapter: adapter ?? null, scouts: dedupeScouts(scouts), evidence: normalizedEvidence });
  return {
    id: `setup_${stableHash(identity)}`,
    status,
    kind,
    title,
    explanation,
    ...(adapter === undefined ? {} : { adapter }),
    scouts: dedupeScouts(scouts),
    evidence: normalizedEvidence,
  };
}

function adapterLabel(adapter: SetupContextAdapter): string {
  return adapter.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function createSelfDrivingSetupPlan(
  inventory: RepositoryInventoryAnalysis,
  options: SelfDrivingSetupOptions = {},
): SelfDrivingSetupPlan {
  if (!inventory || typeof inventory !== "object") throw new Error("Repository inventory is required.");
  if ((inventory as { mode?: unknown }).mode !== "analyze-only") {
    throw new Error("Setup Agent accepts analyze-only Repository Audit inventory only.");
  }

  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`Setup Agent mode '${requestedMode}' is not enabled. Planning is observe-only.`);
  }

  const maxDetectionsPerGroup = options.maxDetectionsPerGroup ?? defaults.maxDetectionsPerGroup;
  const maxSteps = options.maxSteps ?? defaults.maxSteps;
  assertPositiveSafeInteger(maxDetectionsPerGroup, "maxDetectionsPerGroup");
  assertPositiveSafeInteger(maxSteps, "maxSteps");

  const reasons = new Set<SelfDrivingSetupPlan["execution"]["truncationReasons"][number]>();
  const frameworks = boundedDetections(inventory.inventory.frameworks, maxDetectionsPerGroup, "framework-count", reasons);
  const languages = boundedDetections(inventory.inventory.languages, maxDetectionsPerGroup, "language-count", reasons);
  const packageManagers = boundedDetections(inventory.inventory.packageManagers, maxDetectionsPerGroup, "package-manager-count", reasons);
  const deploymentTargets = boundedDetections(inventory.inventory.deploymentTargets, maxDetectionsPerGroup, "deployment-target-count", reasons);

  const steps: SetupPlanStep[] = [
    makeStep(
      "available-now",
      "review-repository-evidence",
      "Review bounded repository evidence",
      "Repository Audit evidence can be reviewed now without connecting live product systems or granting write authority.",
      ["code", "security", "ci"],
      [...frameworks, ...deploymentTargets],
    ),
  ];

  const adapterEvidence = new Map<SetupContextAdapter, RepositoryDetection[]>();
  const adapterScouts = new Map<SetupContextAdapter, SolveScoutKind[]>();

  for (const framework of frameworks) {
    const mapping = frameworkCatalog[framework.name] ?? {
      adapters: ["generic-runtime-signals" as const],
      scouts: ["incident" as const],
    };
    for (const adapter of mapping.adapters) {
      adapterEvidence.set(adapter, [...(adapterEvidence.get(adapter) ?? []), framework]);
      adapterScouts.set(adapter, [...(adapterScouts.get(adapter) ?? []), ...mapping.scouts]);
    }
  }

  if (deploymentTargets.length > 0) {
    adapterEvidence.set("deployment-health", [...(adapterEvidence.get("deployment-health") ?? []), ...deploymentTargets]);
    adapterScouts.set("deployment-health", [...(adapterScouts.get("deployment-health") ?? []), "rollout", "incident"]);
  }

  if (frameworks.length === 0 && deploymentTargets.length === 0) {
    adapterEvidence.set("generic-runtime-signals", []);
    adapterScouts.set("generic-runtime-signals", ["incident"]);
  }

  for (const adapter of [...adapterEvidence.keys()].sort(compareText)) {
    steps.push(makeStep(
      "planned",
      "review-context-adapter",
      `Review ${adapterLabel(adapter)} context adapter`,
      "This is a future read-only context connection candidate. Credentials, retention, redaction, tenancy, and provider-specific bounds require a separate review before connection.",
      adapterScouts.get(adapter) ?? [],
      adapterEvidence.get(adapter) ?? [],
      adapter,
    ));
  }

  const sortedSteps = steps.sort((left, right) => {
    const statusRank = left.status === "available-now" ? 0 : 1;
    const rightStatusRank = right.status === "available-now" ? 0 : 1;
    return statusRank - rightStatusRank || compareText(left.title, right.title) || compareText(left.id, right.id);
  });
  if (sortedSteps.length > maxSteps) reasons.add("step-count");
  const boundedSteps = sortedSteps.slice(0, maxSteps);
  const truncationReasons = [...reasons].sort(compareText);

  return {
    schema: "solvelang.self-driving.setup-plan.v0",
    mode: "analyze-only",
    source: inventory.source,
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      planOnly: true,
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
      emitsCommands: false,
      handlesCredentials: false,
    },
    detected: {
      frameworks: frameworks.map(detectionSummary),
      languages: languages.map(detectionSummary),
      packageManagers: packageManagers.map(detectionSummary),
      deploymentTargets: deploymentTargets.map(detectionSummary),
    },
    limits: {
      maxDetectionsPerGroup,
      maxSteps,
    },
    execution: {
      status: truncationReasons.length > 0 ? "partial" : "complete",
      truncated: truncationReasons.length > 0,
      truncationReasons,
    },
    steps: boundedSteps,
  };
}
