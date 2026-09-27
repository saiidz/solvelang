import { accountAvailability, billingAvailability, previewAvailability } from "../../product-capabilities";

export type ComponentState = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "not_monitored";
export type ComponentMetadata = {
  id: string;
  name: string;
  description: string;
  note?: string;
  monitored: boolean;
};
export type HealthObservation = {
  state: ComponentState;
  checkedAt: string;
  validForMs: number;
};
export type StatusIncidentUpdate = { timestamp: string; message: string };
export type StatusIncident = {
  id: string;
  title: string;
  state: "investigating" | "identified" | "monitoring" | "resolved" | "archived";
  impact: "minor" | "major" | "critical";
  startedAt: string;
  resolvedAt?: string;
  archiveNote?: string;
  external?: { provider: string; statusUrl: string };
  updates: StatusIncidentUpdate[];
};

export const statusPage: {
  lastUpdated: string;
  reportingMode: "live_observations_and_manual_history";
  components: ComponentMetadata[];
  incidents: StatusIncident[];
} = {
  lastUpdated: "2026-09-17T17:56:31Z",
  reportingMode: "live_observations_and_manual_history",
  components: [
    { id: "website", name: "Website", description: "Canonical public site hosted on AWS Amplify.", monitored: true, note: "A successful public-page response measures reachability at the check time, not continuing uptime or every site feature." },
    { id: "api-health", name: "Production API health", description: "Public API /health endpoint.", monitored: true, note: "This checks the public health response only. It does not verify account authentication, persistence, billing, or customer requests." },
    { id: "studio-page", name: "Studio public page", description: "Hosted Workflow Intelligence Studio page.", monitored: true, note: "Page availability does not verify account saving, browser-local projects, or authenticated persistence." },
    { id: "browser-preview", name: "Browser Preview public page", description: "Pinned WebAssembly safe-core preview at /run/.", monitored: true, note: "Page availability does not execute the preview or verify its runtime contract." },
    { id: "repository-audit-page", name: "Repository Audit public page", description: "Public Repository Audit example surface.", monitored: true, note: "Page availability does not verify analysis correctness." },
    { id: "solve-graph-page", name: "Solve Graph public page", description: "Public Solve Graph example surface.", monitored: true, note: "Page availability does not verify graph correctness." },
    { id: "account-persistence", name: "Account authentication and persistence", description: "Customer account and Studio account-saving behavior.", monitored: false, note: accountAvailability },
    { id: "billing", name: "Checkout, payment, and webhooks", description: "Production subscription billing capability.", monitored: false, note: billingAvailability },
    { id: "support", name: "Support automation", description: "Support triage preview and connected automation.", monitored: false, note: previewAvailability },
    { id: "provider-execution", name: "Paid priority and managed execution", description: "Provider-backed and side-effecting execution.", monitored: false, note: "No independent public health signal measures paid priority, providers, or managed workflow execution." },
    { id: "posthog", name: "PostHog", description: "Analytics integration.", monitored: false, note: "No independent public health signal is connected." },
    { id: "ci-deployment", name: "CI and Deployment", description: "GitHub Actions validation and AWS Amplify publishing.", monitored: false, note: "Successful runs do not prove continuing service health or the status of an upstream provider." },
  ],
  incidents: [
    {
      id: "2026-08-06-github-actions",
      title: "GitHub Actions upstream degradation",
      state: "archived",
      impact: "major",
      startedAt: "2026-08-06T15:22:00Z",
      archiveNote: "Historical record retained from August 6. The following messages describe that day's observations, not a current outage. An independently verified closure time was not recorded; no resolution time or uptime is inferred.",
      external: { provider: "GitHub", statusUrl: "https://www.githubstatus.com/" },
      updates: [
        { timestamp: "2026-08-06T22:18:00Z", message: "GitHub reported significant improvement in workflow success rates while standard and larger runners drained queued work. Webhook triggers and some self-hosted runner behavior remained affected. SolveLang CI/deployment should therefore still be treated as degraded until the upstream incident is fully resolved." },
        { timestamp: "2026-08-06T20:34:00Z", message: "GitHub reported continued Actions disruption affecting both GitHub-hosted and self-hosted runners, with webhook processing throttled during recovery." },
        { timestamp: "2026-08-06T15:22:00Z", message: "GitHub began investigating degraded GitHub Actions performance. SolveLang validation jobs may fail to start, queue, or time out while the dependency is degraded." },
      ],
    },
  ],
};
