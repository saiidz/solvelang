// Runner Minutes auto-reload — the site half of the auto-reload
// contract the runners service owns.
//
// The service answers GET /customer/runner-minutes/auto-reload with
// the signed-in customer's per-pool settings, read with the same
// session-authenticated customer pattern as the account view:
//
//   per pool (standard / high-power / premium):
//     { enabled, packKey, packs[], baselineSeconds, balanceSeconds,
//       lastReloadAt, lastStatus }
//   savedPaymentMethod: { brand, last4 } | null
//
// Setting a pool is a POST to the same route with the session's CSRF
// token, like every customer write: { pool, enabled, packKey }.
// Enabling a pool with no saved payment method answers with the
// error code "payment_method_required" — the card then routes the
// customer into the existing Agent Access save-card flow (the
// "Saved card for mandates" section of /account/agent-access/),
// never a new card form of its own. After every write the caller
// re-reads the settings and renders the state the service reports —
// never a blind local flip.

export const RUNNER_MINUTES_AUTO_RELOAD_PATH = "/customer/runner-minutes/auto-reload";

// The Agent Access page hosts the existing save-card flow; it is
// the only place a card is ever collected.
export const RUNNER_MINUTES_SAVE_CARD_PATH = "/account/agent-access/";

// The card's title and body, verbatim (owner-approved copy). The
// body sentence also appears on the buy page under the packs.
export const RUNNER_MINUTES_AUTO_RELOAD_TITLE = "Auto-reload";

export const RUNNER_MINUTES_AUTO_RELOAD_BODY =
  "Keep your workflows running without interruption. Enable auto-reload and your minutes top up automatically at 85% usage — before a running job ever has to wait on balance.";

// Shown when enabling is refused for want of a saved card: plain
// words for what happened and where the save-card flow lives.
export const RUNNER_MINUTES_AUTO_RELOAD_CARD_REQUIRED_LINE =
  "Auto-reload needs a saved card first. Save one in Agent Access, then switch auto-reload on here.";

export const RUNNER_MINUTES_AUTO_RELOAD_NO_CARD_LINE =
  "No saved card yet — auto-reload can only top up from a saved card.";

export type RunnerMinutesAutoReloadPool = "standard" | "high-power" | "premium";

export const RUNNER_MINUTES_AUTO_RELOAD_POOLS: ReadonlyArray<RunnerMinutesAutoReloadPool> = [
  "standard",
  "high-power",
  "premium",
];

export function runnerMinutesAutoReloadPoolLabel(pool: RunnerMinutesAutoReloadPool): "Standard" | "High-Power" | "Premium" {
  if (pool === "high-power") return "High-Power";
  if (pool === "premium") return "Premium";
  return "Standard";
}

// One pack the service offers for a pool's reload, in the shape the
// auto-reload view carries it. The service is the catalog authority
// for reloads; the card renders what it sends.
export type RunnerMinutesAutoReloadPackOption = {
  key: string;
  label?: string;
  minutes?: number;
  totalDollars?: number;
};

export type RunnerMinutesAutoReloadPoolView = {
  enabled?: boolean;
  packKey?: string | null;
  packs?: RunnerMinutesAutoReloadPackOption[];
  baselineSeconds?: number;
  balanceSeconds?: number;
  lastReloadAt?: string | null;
  lastStatus?: string | null;
};

export type RunnerMinutesSavedPaymentMethod = {
  brand: string;
  last4: string;
};

// The auto-reload view as the service sends it. The per-pool
// settings may arrive as a record keyed by pool or as a list of
// pool-tagged entries; the normalizer below accepts both so the
// card never depends on one wire shape.
export type RunnerMinutesAutoReloadView = {
  pools?: Partial<Record<RunnerMinutesAutoReloadPool, RunnerMinutesAutoReloadPoolView>>
    | Array<RunnerMinutesAutoReloadPoolView & { pool?: string }>;
  standard?: RunnerMinutesAutoReloadPoolView;
  "high-power"?: RunnerMinutesAutoReloadPoolView;
  premium?: RunnerMinutesAutoReloadPoolView;
  savedPaymentMethod?: RunnerMinutesSavedPaymentMethod | null;
};

export type RunnerMinutesAutoReloadPoolSettings = {
  pool: RunnerMinutesAutoReloadPool;
  enabled: boolean;
  packKey: string | null;
  packs: RunnerMinutesAutoReloadPackOption[];
  baselineSeconds: number | null;
  balanceSeconds: number | null;
  lastReloadAt: string | null;
  lastStatus: string | null;
};

function normalizePoolView(raw: RunnerMinutesAutoReloadPoolView | undefined): Omit<RunnerMinutesAutoReloadPoolSettings, "pool"> {
  return {
    enabled: raw?.enabled === true,
    packKey: typeof raw?.packKey === "string" && raw.packKey ? raw.packKey : null,
    packs: Array.isArray(raw?.packs) ? raw.packs.filter((pack) => pack && typeof pack.key === "string") : [],
    baselineSeconds: typeof raw?.baselineSeconds === "number" ? raw.baselineSeconds : null,
    balanceSeconds: typeof raw?.balanceSeconds === "number" ? raw.balanceSeconds : null,
    lastReloadAt: typeof raw?.lastReloadAt === "string" && raw.lastReloadAt ? raw.lastReloadAt : null,
    lastStatus: typeof raw?.lastStatus === "string" && raw.lastStatus ? raw.lastStatus : null,
  };
}

// Every pool the card renders, in display order, with the service's
// values where it sent them and safe defaults (off, no pack) where
// it did not — a pool the service omits reads as not enabled, never
// as on.
export function runnerMinutesAutoReloadPools(
  view: RunnerMinutesAutoReloadView,
): RunnerMinutesAutoReloadPoolSettings[] {
  const byPool = new Map<string, RunnerMinutesAutoReloadPoolView>();
  if (Array.isArray(view.pools)) {
    for (const entry of view.pools) {
      if (entry && typeof entry.pool === "string") byPool.set(entry.pool, entry);
    }
  } else if (view.pools && typeof view.pools === "object") {
    for (const [pool, entry] of Object.entries(view.pools)) {
      if (entry) byPool.set(pool, entry);
    }
  }
  for (const pool of RUNNER_MINUTES_AUTO_RELOAD_POOLS) {
    const direct = view[pool];
    if (direct && !byPool.has(pool)) byPool.set(pool, direct);
  }
  return RUNNER_MINUTES_AUTO_RELOAD_POOLS.map((pool) => ({ pool, ...normalizePoolView(byPool.get(pool)) }));
}

export function runnerMinutesSavedPaymentMethod(
  view: RunnerMinutesAutoReloadView,
): RunnerMinutesSavedPaymentMethod | null {
  const method = view.savedPaymentMethod;
  if (!method || typeof method.brand !== "string" || typeof method.last4 !== "string") return null;
  return method;
}

// The saved card as the card shows it: "Visa ···· 4242".
export function runnerMinutesSavedCardLabel(method: RunnerMinutesSavedPaymentMethod): string {
  return `${method.brand} ···· ${method.last4}`;
}

// True when a write was refused because no payment method is
// saved: the service's error code is the signal, carried on the
// customer API error like every other service refusal.
export function runnerMinutesAutoReloadNeedsPaymentMethod(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    (caught as { code?: unknown }).code === "payment_method_required"
  );
}

export function runnerMinutesAutoReloadPackLabel(pack: RunnerMinutesAutoReloadPackOption): string {
  if (pack.label) return pack.label;
  if (typeof pack.minutes === "number") {
    const minutes = `${pack.minutes.toLocaleString("en-US")} minutes`;
    return typeof pack.totalDollars === "number" ? `${minutes} · $${pack.totalDollars}` : minutes;
  }
  return pack.key;
}

// Seconds as the whole minutes the card speaks in.
export function runnerMinutesAutoReloadMinutesLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.round(seconds / 60).toLocaleString("en-US")} minutes`;
}

// The last reload, in plain words — a failed reload is stated as
// failed, never softened or hidden. The time renders in fixed UTC,
// the same unambiguous clock reading the approvals list uses. An
// unparseable value is shown as-is rather than hidden.
export function runnerMinutesAutoReloadLastLine(settings: RunnerMinutesAutoReloadPoolSettings): string | null {
  if (!settings.lastStatus && !settings.lastReloadAt) return null;
  let when: string | null = null;
  if (settings.lastReloadAt) {
    const parsed = new Date(settings.lastReloadAt);
    when = Number.isNaN(parsed.getTime())
      ? settings.lastReloadAt
      : `${parsed.toUTCString().replace(" GMT", "")} UTC`;
  }
  const at = when ? ` (${when})` : "";
  if (settings.lastStatus === "failed") {
    return `The last auto-reload failed${at} — your minutes were not topped up.`;
  }
  if (settings.lastStatus === "succeeded" || settings.lastStatus === "success") {
    return `Last auto-reload succeeded${at}.`;
  }
  if (settings.lastStatus) {
    return `Last auto-reload: ${settings.lastStatus}${at}.`;
  }
  return `Last auto-reload${at}.`;
}
