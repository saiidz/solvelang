import { accountAvailability, billingAvailability, previewAvailability } from "../../product-capabilities";

export type ComponentState = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "not_monitored";
export type ComponentStatus = {
  name: string;
  description: string;
  state: ComponentState;
  note?: string;
  // Only a real health observation may set these. A deploy timestamp is not a health observation.
  checkedAt?: string;
  validForMs?: number;
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
  reportingMode: "manual";
  components: ComponentStatus[];
  incidents: StatusIncident[];
} = {
  lastUpdated: "2026-09-17T17:56:31Z",
  reportingMode: "manual",
  components: [
    { name: "Website", description: "Public site hosted on AWS Amplify.", state: "not_monitored", note: "The owner reported successful deployments 732 and 733 on September 13, 2026. Deployment success is historical evidence, not an independent live uptime measurement." },
    { name: "Browser Preview", description: "Pinned WebAssembly safe-core preview at /run/.", state: "not_monitored", note: "Runs locally with host side effects denied. This is not the hosted full runtime." },
    { name: "Workflow Intelligence Studio", description: "Local-first deterministic workflow modeling, analysis, and simulation.", state: "not_monitored", note: "Local analysis and hosted-page availability are different things. No independent public health feed is connected." },
    { name: "Audit and support previews", description: "Interactive workflow mapping and triage examples.", state: "not_monitored", note: previewAvailability },
    { name: "API Access and Customer Accounts", description: "Deployed production account and API-access infrastructure.", state: "not_monitored", note: accountAvailability },
    { name: "API Subscription Billing", description: "Enabled for controlled production rollout; not independently monitored.", state: "not_monitored", note: billingAvailability },
    { name: "CI and Deployment", description: "GitHub Actions validation and AWS Amplify site publishing.", state: "not_monitored", note: "Successful runs are recorded in GitHub and Amplify. They do not prove continuing service health or the status of an upstream provider." },
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
