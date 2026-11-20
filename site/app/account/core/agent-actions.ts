// Agent access — the account-side contract for Level 3 agent
// actions: delegated tokens, standing top-up mandates, purchase
// approvals, and the activity log. The page under
// app/account/agent-access renders this surface; the pure helpers
// here are the pinned wording and formatting every state shares.
//
// Two services back the page:
//   - the api-access service holds the delegated tokens and the
//     API-plan purchases an agent prepared
//     (GET/POST /customer/agent-tokens,
//      GET/POST /customer/agent-plan-purchases);
//   - the runner-minutes service holds the mandates, the minutes
//     purchase preparations, the saved payment method, and the
//     activity log (/customer/runner-minutes/agent/...).
// Both are read with the signed-in session, and every write carries
// the session CSRF token, like every other customer write.

export type AgentTokenView = {
  tokenId: string;
  label: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type AgentTokenScope = {
  scope: string;
  label: string;
  description: string;
};

export const AGENT_TOKEN_SCOPES: AgentTokenScope[] = [
  {
    scope: "purchase:runner-minutes",
    label: "Buy runner minutes",
    description: "Prepare runner-minutes purchases for your approval, or buy under an armed mandate.",
  },
  {
    scope: "purchase:api-plans",
    label: "Buy API plans",
    description: "Prepare API plan purchases for your approval, or buy under an armed mandate that covers API plans.",
  },
  {
    scope: "mandates:manage",
    label: "Manage top-up mandates",
    description: "Draft new top-up mandates (you still arm them yourself) and revoke existing ones.",
  },
  {
    scope: "purchases:read",
    label: "Read purchases and mandates",
    description: "Check the state of purchases and list your mandates.",
  },
];

export type AgentMandateView = {
  id: string;
  status: "draft" | "armed" | "paused" | "revoked" | "expired";
  pool: "standard" | "high-power";
  packKey: string;
  thresholdSeconds: number;
  perPurchaseCapCents: number;
  monthlyCapCents: number;
  coversApiPlans: boolean;
  expiresAt: string | null;
  agentLabel: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
};

export type AgentPurchaseIntentView = {
  id: string;
  kind?: string;
  packKey?: string;
  plan?: string;
  pool?: string;
  amountCents: number;
  status: string;
  mandateId: string | null;
  agentLabel: string | null;
  createdAt: string;
};

export type AgentAuditEntryView = {
  id: string;
  at: string;
  agentLabel: string | null;
  tool: string | null;
  action: string;
  outcome: string;
  summary: string | null;
};

export type AgentPaymentMethodView = {
  configured: boolean;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
};

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatThreshold(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}`
    : `${minutes} minutes`;
}

export function mandateStatusLine(mandate: AgentMandateView): string {
  switch (mandate.status) {
    case "draft":
      return "Draft — does nothing until you arm it.";
    case "armed":
      return "Armed — buys automatically within its caps.";
    case "paused":
      return "Paused — will not buy until you resume it.";
    case "revoked":
      return "Revoked — permanently off.";
    case "expired":
      return "Expired — its end date has passed.";
    default:
      return mandate.status;
  }
}

export type MinutesApprovalCheckout = {
  clientSecret: string;
  publishableKey: string;
};

// The runners approve endpoint answers { intent, checkout }: the
// embedded-checkout material (the PaymentIntent client secret and
// the publishable key) lives on the NESTED checkout object, never at
// the top level. Reading it from the top level is the defect that
// left the Nov 19, 2026 approval with a PaymentIntent created
// server-side and no payment step on the page - the activity log
// even said "embedded checkout opened". Anything that is not the
// full nested pair is not a checkout: the page falls back to a
// reload instead of presenting a half-built payment box.
export function minutesCheckoutFromApproval(result: unknown): MinutesApprovalCheckout | null {
  if (!result || typeof result !== "object") return null;
  const checkout = (result as { checkout?: unknown }).checkout;
  if (!checkout || typeof checkout !== "object") return null;
  const { clientSecret, publishableKey } = checkout as { clientSecret?: unknown; publishableKey?: unknown };
  if (typeof clientSecret !== "string" || !clientSecret) return null;
  if (typeof publishableKey !== "string" || !publishableKey) return null;
  return { clientSecret, publishableKey };
}

export function purchaseStatusLine(status: string): string {
  switch (status) {
    case "approval_required":
      return "Waiting for your approval";
    case "checkout_ready":
      return "Approved — payment in progress";
    case "executing":
      return "Buying now";
    case "completed":
      return "Completed";
    case "cap_blocked":
      return "Refused — mandate cap reached";
    case "rejected":
      return "Rejected";
    case "refused":
      return "Refused";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export function auditOutcomeLine(outcome: string): string {
  switch (outcome) {
    case "executed":
      return "Bought";
    case "approval_required":
      return "Prepared for approval";
    case "prepared":
      return "Prepared";
    case "refused_cap":
      return "Refused — cap reached";
    case "refused_scope":
      return "Refused — token lacks the scope";
    case "refused_rate_limit":
      return "Refused — rate limit";
    case "refused_mandate_revoked":
      return "Refused — mandate revoked";
    case "refused_mandate_not_armed":
      return "Refused — mandate not armed";
    case "rejected_by_owner":
      return "Rejected by you";
    case "mandate_armed":
      return "Mandate armed by you";
    case "mandate_drafted":
      return "Mandate drafted";
    case "mandate_revoked":
      return "Mandate revoked";
    case "mandate_paused":
      return "Mandate paused";
    case "mandate_resumed":
      return "Mandate resumed";
    case "payment_method_saved":
      return "Card saved";
    case "payment_method_removed":
      return "Card removed";
    default:
      return outcome;
  }
}

// The packs an agent mandate can buy, exactly as the shelf states
// them. Keys match the runners service pack keys.
export const MANDATE_PACK_OPTIONS: { pool: "standard" | "high-power"; packKey: string; label: string }[] = [
  { pool: "standard", packKey: "standard-5000", label: "Standard — 5,000 minutes · $20" },
  { pool: "standard", packKey: "standard-25000", label: "Standard — 25,000 minutes · $100" },
  { pool: "standard", packKey: "standard-100000", label: "Standard — 100,000 minutes · $400" },
  { pool: "high-power", packKey: "high-power-1000", label: "High-power — 1,000 minutes · $80" },
  { pool: "high-power", packKey: "high-power-2000", label: "High-power — 2,000 minutes · $140" },
  { pool: "high-power", packKey: "high-power-3000", label: "High-power — 3,000 minutes · $192" },
  { pool: "high-power", packKey: "high-power-4000", label: "High-power — 4,000 minutes · $236" },
  { pool: "high-power", packKey: "high-power-5000", label: "High-power — 5,000 minutes · $275" },
  { pool: "high-power", packKey: "high-power-6000", label: "High-power — 6,000 minutes · $306" },
  { pool: "high-power", packKey: "high-power-7000", label: "High-power — 7,000 minutes · $336" },
  { pool: "high-power", packKey: "high-power-8000", label: "High-power — 8,000 minutes · $360" },
  { pool: "high-power", packKey: "high-power-9000", label: "High-power — 9,000 minutes · $382.50" },
  { pool: "high-power", packKey: "high-power-10000", label: "High-power — 10,000 minutes · $400" },
];
