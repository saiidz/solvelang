// Owner runner-minutes panel: the shapes the admin page renders and
// the defensive normalization between the api-access owner proxy
// (GET /customer/runner-minutes-admin/accounts) and the screen. The
// proxy answers { configured: false } to everyone who is not the
// owner, so "not available for your account" and "not wired yet"
// are the same honest state here — the page never sees another
// account's data either way, and it never invents a balance.

export type RunnerMinutesAdminAccount = {
  tenantId: string;
  status: "active" | "paused";
  standardMinutes: number;
  standardSeconds: number;
  highPowerMinutes: number;
  highPowerSeconds: number;
  cacheGbMonths: number;
  nearestLotExpiresAt: string | null;
};

export type RunnerMinutesAdminAccounts = {
  configured: boolean;
  accounts: RunnerMinutesAdminAccount[];
};

export type RunnerMinutesPool = "standard" | "high-power";

export type RunnerMinutesAdminAction = "credit" | "debit" | "pause" | "resume";

export const ADMIN_ACCOUNTS_PATH = "/customer/runner-minutes-admin/accounts";

export function adminActionPath(tenantId: string, action: RunnerMinutesAdminAction): string {
  return `${ADMIN_ACCOUNTS_PATH}/${encodeURIComponent(tenantId)}/${action}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeAdminAccount(raw: unknown): RunnerMinutesAdminAccount | null {
  const account = asRecord(raw);
  const tenantId = asText(account.tenantId);
  if (!tenantId) return null;
  const balances = asRecord(account.balances);
  const standard = asRecord(balances.standard);
  const highPower = asRecord(balances.highPower);
  const cache = asRecord(balances.cache);
  return {
    tenantId,
    status: account.status === "paused" ? "paused" : "active",
    standardMinutes: asNumber(standard.minutes),
    standardSeconds: asNumber(standard.seconds),
    highPowerMinutes: asNumber(highPower.minutes),
    highPowerSeconds: asNumber(highPower.seconds),
    cacheGbMonths: asNumber(cache.gbMonths),
    nearestLotExpiresAt:
      typeof account.nearestLotExpiresAt === "string" ? account.nearestLotExpiresAt : null,
  };
}

export function normalizeAdminAccounts(raw: unknown): RunnerMinutesAdminAccounts {
  const root = asRecord(raw);
  if (root.configured !== true) return { configured: false, accounts: [] };
  const accounts = asArray(root.accounts)
    .map((item) => normalizeAdminAccount(item))
    .filter((account): account is RunnerMinutesAdminAccount => account !== null);
  return { configured: true, accounts };
}

// The mutation answer carries the tenant's fresh account row; the
// page swaps its row for this instead of trusting its own arithmetic.
export function normalizeAdminActionResult(raw: unknown): RunnerMinutesAdminAccount | null {
  return normalizeAdminAccount(asRecord(raw).account);
}

export function formatMinuteCount(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  return `${whole.toLocaleString("en-US")} ${whole === 1 ? "minute" : "minutes"}`;
}

export function formatNearestExpiry(iso: string | null): string {
  if (!iso) return "No minutes expire yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No minutes expire yet";
  const label = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Next expiry ${label}`;
}

export function parseMinutesInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
