export type ComponentState =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "not_monitored";

export type ComponentStatus = {
  name: string;
  description: string;
  state: ComponentState;
  note?: string;
};

export type StatusIncidentUpdate = {
  timestamp: string;
  message: string;
};

export type StatusIncident = {
  id: string;
  title: string;
  state: "investigating" | "identified" | "monitoring" | "resolved";
  impact: "minor" | "major" | "critical";
  startedAt: string;
  resolvedAt?: string;
  external?: {
    provider: string;
    statusUrl: string;
  };
  updates: StatusIncidentUpdate[];
};

export const statusPage = {
  lastUpdated: "2026-08-06T22:43:00Z",
  reportingMode: "manual" as const,
  components: [
    {
      name: "Website",
      description: "Public SolveLang website and documentation experience.",
      state: "not_monitored",
      note: "No independent uptime monitor is connected yet; status is reported manually.",
    },
    {
      name: "Browser Preview",
      description: "Static browser-safe SolveLang subset available from the /run experience.",
      state: "not_monitored",
      note: "The preview is intentionally limited and is not the canonical Rust runtime.",
    },
    {
      name: "Workflow Intelligence Studio",
      description: "Local-first deterministic workflow modeling and analysis in the browser.",
      state: "not_monitored",
      note: "Studio analysis runs locally in the browser; hosted page availability is not independently monitored yet.",
    },
    {
      name: "API Access",
      description: "API-key, usage, and account infrastructure currently operated in test mode.",
      state: "not_monitored",
      note: "Experimental/test-mode capability. This status page does not represent it as a production public API.",
    },
    {
      name: "Accounts and Billing",
      description: "Customer account, subscription, payment-method, and usage interfaces.",
      state: "not_monitored",
      note: "Experimental/test-mode infrastructure; no production availability SLA is claimed.",
    },
    {
      name: "CI and Deployment",
      description: "GitHub-hosted and self-hosted Actions used for validation and deployment workflows.",
      state: "degraded",
      note: "Upstream GitHub Actions incident is delaying or preventing workflow execution. SolveLang local validation remains separate from GitHub service health.",
    },
  ] satisfies ComponentStatus[],
  incidents: [
    {
      id: "2026-08-06-github-actions",
      title: "GitHub Actions upstream degradation",
      state: "monitoring",
      impact: "major",
      startedAt: "2026-08-06T15:22:00Z",
      external: {
        provider: "GitHub",
        statusUrl: "https://www.githubstatus.com/",
      },
      updates: [
        {
          timestamp: "2026-08-06T22:18:00Z",
          message:
            "GitHub reported significant improvement in workflow success rates while standard and larger runners drained queued work. Webhook triggers and some self-hosted runner behavior remained affected. SolveLang CI/deployment should therefore still be treated as degraded until the upstream incident is fully resolved.",
        },
        {
          timestamp: "2026-08-06T20:34:00Z",
          message:
            "GitHub reported continued Actions disruption affecting both GitHub-hosted and self-hosted runners, with webhook processing throttled during recovery.",
        },
        {
          timestamp: "2026-08-06T15:22:00Z",
          message:
            "GitHub began investigating degraded GitHub Actions performance. SolveLang validation jobs may fail to start, queue, or time out while the dependency is degraded.",
        },
      ],
    },
  ] satisfies StatusIncident[],
};
