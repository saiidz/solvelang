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

export const statusPage: {
  lastUpdated: string;
  reportingMode: "manual";
  components: ComponentStatus[];
  incidents: StatusIncident[];
} = {
  lastUpdated: "2026-09-13T20:49:00Z",
  reportingMode: "manual",
  components: [
    {
      name: "Website",
      description: "Public SolveLang website and documentation experience on AWS Amplify.",
      state: "operational",
      note: "The latest verified Amplify deployment completed successfully on Sep 13, 2026. Independent uptime monitoring is not connected yet.",
    },
    {
      name: "Browser Preview",
      description: "Static browser-safe SolveLang subset available from the /run experience.",
      state: "not_monitored",
      note: "The preview is deployed with the public site, intentionally limited, and not the canonical Rust runtime.",
    },
    {
      name: "Workflow Intelligence Studio",
      description: "Local-first deterministic workflow modeling and analysis in the browser.",
      state: "not_monitored",
      note: "Studio analysis runs locally in the browser; hosted page availability is not independently monitored yet.",
    },
    {
      name: "API Access",
      description: "Production API-key, usage, customer-account, and entitlement infrastructure.",
      state: "operational",
      note: "API access and customer accounts are enabled in the production stack. Production billing remains disabled.",
    },
    {
      name: "Accounts and Billing",
      description: "Customer authentication, account management, subscription, and usage interfaces.",
      state: "not_monitored",
      note: "Customer accounts and authenticator 2FA infrastructure are deployed. Subscription billing is intentionally disabled until production Stripe enablement is approved and configured.",
    },
    {
      name: "CI and Deployment",
      description: "GitHub Actions validation plus AWS Amplify site deployment.",
      state: "operational",
      note: "Recent exact-head CI, Rust, and WASM security checks passed, and the latest public-site deployments completed successfully.",
    },
  ],
  incidents: [],
};
