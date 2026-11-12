// Runner Minutes purchase page — pure catalog and copy.
//
// Mirrors the runners service catalog (saiidz/solvelang-runners,
// src/pricing.js): same pack keys, same totals. The service is the
// charging authority; these are the display facts the page renders,
// pinned by the tests in runner-minutes-checkout.test.ts so the two
// can never silently drift apart on a number.

export type RunnerMinutesPool = "standard" | "high-power" | "cache";

export type RunnerMinutesPack = {
  key: string;
  pool: RunnerMinutesPool;
  label: string;
  detail: string;
  minutes: number | null;
  gbMonths: number | null;
  totalDollars: number;
  anchor: boolean;
};

export const RUNNER_MINUTES_STANDARD_PACKS: ReadonlyArray<RunnerMinutesPack> = [
  { key: "standard-5000", pool: "standard", label: "5,000 minutes", detail: "$0.004 per minute · standard Linux machines (2 cores)", minutes: 5_000, gbMonths: null, totalDollars: 20, anchor: true },
  { key: "standard-25000", pool: "standard", label: "25,000 minutes", detail: "$0.004 per minute · standard Linux machines (2 cores)", minutes: 25_000, gbMonths: null, totalDollars: 100, anchor: true },
  { key: "standard-100000", pool: "standard", label: "100,000 minutes", detail: "$0.004 per minute · standard Linux machines (2 cores)", minutes: 100_000, gbMonths: null, totalDollars: 400, anchor: true },
];

// Owner anchors are the 1,000 / 2,000 / 10,000 rungs; the rungs between
// were completed on a slide whose totals strictly climb.
export const RUNNER_MINUTES_HIGH_POWER_PACKS: ReadonlyArray<RunnerMinutesPack> = [
  { key: "high-power-1000", pool: "high-power", label: "1,000 minutes", detail: "$0.08 per minute · 16-core machines", minutes: 1_000, gbMonths: null, totalDollars: 80, anchor: true },
  { key: "high-power-2000", pool: "high-power", label: "2,000 minutes", detail: "$0.07 per minute · 16-core machines", minutes: 2_000, gbMonths: null, totalDollars: 140, anchor: true },
  { key: "high-power-3000", pool: "high-power", label: "3,000 minutes", detail: "$0.064 per minute · 16-core machines", minutes: 3_000, gbMonths: null, totalDollars: 192, anchor: false },
  { key: "high-power-4000", pool: "high-power", label: "4,000 minutes", detail: "$0.059 per minute · 16-core machines", minutes: 4_000, gbMonths: null, totalDollars: 236, anchor: false },
  { key: "high-power-5000", pool: "high-power", label: "5,000 minutes", detail: "$0.055 per minute · 16-core machines", minutes: 5_000, gbMonths: null, totalDollars: 275, anchor: false },
  { key: "high-power-6000", pool: "high-power", label: "6,000 minutes", detail: "$0.051 per minute · 16-core machines", minutes: 6_000, gbMonths: null, totalDollars: 306, anchor: false },
  { key: "high-power-7000", pool: "high-power", label: "7,000 minutes", detail: "$0.048 per minute · 16-core machines", minutes: 7_000, gbMonths: null, totalDollars: 336, anchor: false },
  { key: "high-power-8000", pool: "high-power", label: "8,000 minutes", detail: "$0.045 per minute · 16-core machines", minutes: 8_000, gbMonths: null, totalDollars: 360, anchor: false },
  { key: "high-power-9000", pool: "high-power", label: "9,000 minutes", detail: "$0.0425 per minute · 16-core machines", minutes: 9_000, gbMonths: null, totalDollars: 382.5, anchor: false },
  { key: "high-power-10000", pool: "high-power", label: "10,000 minutes", detail: "$0.04 per minute · 16-core machines", minutes: 10_000, gbMonths: null, totalDollars: 400, anchor: true },
];

export const RUNNER_MINUTES_CACHE_PACKS: ReadonlyArray<RunnerMinutesPack> = [
  { key: "speed-lane-cache-10", pool: "cache", label: "Speed lane cache · 10 GB-months", detail: "$0.20 per GB-month · cache stored next to the machines", minutes: null, gbMonths: 10, totalDollars: 2, anchor: true },
];

export const RUNNER_MINUTES_ALL_PACKS: ReadonlyArray<RunnerMinutesPack> = [
  ...RUNNER_MINUTES_STANDARD_PACKS,
  ...RUNNER_MINUTES_HIGH_POWER_PACKS,
  ...RUNNER_MINUTES_CACHE_PACKS,
];

export const RUNNER_MINUTES_DEFAULT_PACK = RUNNER_MINUTES_STANDARD_PACKS[0];

// An absent or invalid pack in the URL falls back to the default
// rather than bouncing the signed-in buyer elsewhere.
export function resolveRunnerMinutesPack(requested: string | null): RunnerMinutesPack {
  if (!requested) return RUNNER_MINUTES_DEFAULT_PACK;
  return RUNNER_MINUTES_ALL_PACKS.find((pack) => pack.key === requested) ?? RUNNER_MINUTES_DEFAULT_PACK;
}

// The owner-confirmed flow, in the customer's words.
export const RUNNER_MINUTES_FLOW_STEPS: ReadonlyArray<string> = [
  "Subscribe by buying a prepaid pack — minutes land in your balance and never auto-renew.",
  "We look at your repositories' real job history and recommend how many runners you need, and at what power — with the reasons in plain language.",
  "You confirm the recommendation. Nothing spins up before you confirm.",
  "Your confirmation sends the order to the fleet.",
  "For each queued job, a fresh Linux machine spins up, runs the job, and is destroyed. Minutes meter per second.",
  "Your account shows the balance and every job's minutes — Spot and on-demand minutes always as separate lines.",
];

export const RUNNER_MINUTES_LABELS = {
  standard: "runs-on: [self-hosted, solvelang-runners-standard]",
  highPower: "runs-on: [self-hosted, solvelang-runners-high-power]",
  speedLane: "runs-on: [self-hosted, solvelang-runners-high-power, solvelang-runners-speed]",
} as const;

// The pack terms, matching what the service enforces (its pricing.js
// carries the long forms).
export const RUNNER_MINUTES_TERMS: ReadonlyArray<string> = [
  "Minutes are metered per second, with a 10-second minimum per job.",
  "Most jobs run on spare cloud capacity (Spot). If Spot cannot start your job within about 90 seconds, it starts on guaranteed capacity instead — those on-demand minutes draw your balance at twice the pack rate, and your usage page always shows them as a separate line.",
  "Prepaid minutes expire 12 months after purchase. Your balance and its expiry are always visible in your account.",
  "Every job runs on a fresh Linux machine created for that job alone and destroyed when the job ends.",
  "Linux runners for private repositories.",
];
