// SolveLang CI Bill Check - pure rendering for the page.
//
// The check itself runs on SolveLang's API (POST
// /public/ci-bill-check): it reads a public repository's most
// recent completed workflow runs from the GitHub API and prices
// the real job seconds under two billing models - GitHub's
// per-minute rounding and SolveLang Standard's per-second
// metering. This module validates that response and renders it
// in plain language and as markdown.
//
// Honesty discipline: the figures are totals over the stated
// sample only - never projected, never estimated. GitHub does
// not charge for standard runners on public repositories; the
// response carries that statement and this module never drops
// it. When the API says the data is unavailable or a read
// failed, the page states exactly that and shows no totals.

export type BillAvailability = "ok" | "unavailable" | "failed";

export type BillOsTotals = {
  jobs: number;
  seconds: number;
  githubMinutes: number;
  githubUsd: number;
};

export type CiBillCheck = {
  schema: "solvelang.ci-bill-check.v1";
  repo: string;
  url: string;
  readAt: string;
  cached: boolean;
  availability: BillAvailability;
  statement: string;
  modelStatement: string;
  rates: {
    githubPerMinuteUsd: { linux: number; windows: number; macos: number };
    standardPerMinuteUsd: number;
    standardMinimumSeconds: number;
    provenance: string;
  };
  sample: {
    runs: number;
    jobs: number;
    measuredJobs: number;
    selfHostedJobs: number;
    unknownOsJobs: number;
    unmeasuredJobs: number;
    jobsListsFailed: number;
    jobsListsTruncated: number;
    windowFrom: string | null;
    windowTo: string | null;
  } | null;
  totals: {
    measuredJobs: number;
    byOs: { linux: BillOsTotals; windows: BillOsTotals; macos: BillOsTotals };
    githubModel: { totalUsd: number; linuxUsd: number; otherOsUsd: number };
    solvelangModel: { linuxSecondsBilled: number; linuxUsd: number };
    linuxDifferenceUsd: number;
  } | null;
  routes: { route: string; status: "ok" | "failed"; detail?: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBillCheckResponse(value: unknown): CiBillCheck {
  if (!isRecord(value) || value.schema !== "solvelang.ci-bill-check.v1") {
    throw new Error("The check response did not carry the expected schema.");
  }
  if (typeof value.repo !== "string" || typeof value.availability !== "string" || typeof value.statement !== "string") {
    throw new Error("The check response was missing its repository, availability, or statement.");
  }
  if (value.availability === "ok" && !isRecord(value.totals)) {
    throw new Error("The check response claimed priced totals but carried none.");
  }
  return value as CiBillCheck;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatUsdOrSubCent(value: number, hasWork: boolean): string {
  if (value === 0 && hasWork) return "under $0.01";
  return formatUsd(value);
}

export function buildBillSummary(check: CiBillCheck): string[] {
  const lines: string[] = [];
  if (check.availability !== "ok" || !check.totals || !check.sample) {
    lines.push(check.statement);
    lines.push(check.modelStatement);
    return lines;
  }
  const { sample, totals } = check;
  lines.push(`Sample: the ${sample.runs} most recent completed workflow runs${sample.windowFrom && sample.windowTo ? ` (started ${sample.windowFrom} to ${sample.windowTo})` : ""}, ${sample.jobs} jobs read, ${totals.measuredJobs} measured GitHub-hosted jobs. Read at ${check.readAt}${check.cached ? " (cached read)" : ""}.`);
  const linux = totals.byOs.linux;
  if (linux.jobs > 0) {
    lines.push(`Linux jobs: ${linux.seconds} seconds of measured work across ${linux.jobs} jobs. Under GitHub's per-minute model that is ${linux.githubMinutes} billed minutes = ${formatUsd(totals.githubModel.linuxUsd)}. Under SolveLang Standard's per-second model it is ${totals.solvelangModel.linuxSecondsBilled} billed seconds = ${formatUsdOrSubCent(totals.solvelangModel.linuxUsd, totals.solvelangModel.linuxSecondsBilled > 0)}. Difference on this sample: ${formatUsd(totals.linuxDifferenceUsd)}.`);
  } else {
    lines.push("The sample contains no Linux jobs, so there is no per-second comparison to make: SolveLang runners are Linux-only today.");
  }
  const otherJobs = totals.byOs.windows.jobs + totals.byOs.macos.jobs;
  if (otherJobs > 0) {
    lines.push(`Windows and macOS jobs (${otherJobs}) are not in the comparison - SolveLang runners are Linux-only today. Under GitHub's model they total ${formatUsd(totals.githubModel.otherOsUsd)} on this sample.`);
  }
  if (sample.selfHostedJobs > 0) {
    lines.push(`Self-hosted jobs excluded: ${sample.selfHostedJobs} (they carry no GitHub per-minute charge).`);
  }
  if (sample.jobsListsFailed > 0) {
    lines.push(`Note: ${sample.jobsListsFailed} of the sampled runs' job lists could not be read; the totals cover the runs that were read.`);
  }
  lines.push(check.modelStatement);
  lines.push(`Rates: ${check.rates.provenance}`);
  return lines;
}

export function renderBillCheckMarkdown(check: CiBillCheck): string {
  const lines: string[] = [];
  lines.push(`# CI Bill Check - ${check.repo}`);
  lines.push("");
  lines.push(`- Repository: ${check.url}`);
  lines.push(`- Read at: ${check.readAt}${check.cached ? " (served from the check cache; the read time is the original read)" : ""}`);
  lines.push(`- Availability: ${check.availability}`);
  lines.push("");
  for (const line of buildBillSummary(check)) {
    lines.push(line);
    lines.push("");
  }
  if (check.totals) {
    lines.push("## Totals over the sample");
    lines.push("");
    lines.push(`- Linux: ${check.totals.byOs.linux.jobs} jobs, ${check.totals.byOs.linux.seconds}s measured, ${check.totals.byOs.linux.githubMinutes} GitHub-billed minutes (${formatUsd(check.totals.byOs.linux.githubUsd)}), SolveLang Standard ${check.totals.solvelangModel.linuxSecondsBilled} billed seconds (${formatUsdOrSubCent(check.totals.solvelangModel.linuxUsd, check.totals.solvelangModel.linuxSecondsBilled > 0)})`);
    lines.push(`- Windows: ${check.totals.byOs.windows.jobs} jobs, ${check.totals.byOs.windows.seconds}s measured, ${check.totals.byOs.windows.githubMinutes} GitHub-billed minutes (${formatUsd(check.totals.byOs.windows.githubUsd)})`);
    lines.push(`- macOS: ${check.totals.byOs.macos.jobs} jobs, ${check.totals.byOs.macos.seconds}s measured, ${check.totals.byOs.macos.githubMinutes} GitHub-billed minutes (${formatUsd(check.totals.byOs.macos.githubUsd)})`);
    lines.push(`- Difference on Linux (GitHub model minus SolveLang Standard model): ${formatUsd(check.totals.linuxDifferenceUsd)}`);
    lines.push("");
  }
  lines.push("## Routes");
  lines.push("");
  for (const route of check.routes) {
    lines.push(`- ${route.route} - ${route.status}${route.detail ? ` (${route.detail})` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Typed-minutes mode (SEO Phase 1a, build order #1).
//
// The visitor types the Linux / Windows / macOS minutes from their own
// GitHub bill and gets two figures for those same minutes: GitHub's bill
// on the published January 2026 rate card, and SolveLang Standard at
// $0.004/min metered per second. This is an estimate from the visitor's
// invoice numbers - it is computed entirely on the client and is never
// sent to the bill-check API, whose rates price real measured runs and
// are a separate, older card. Typed minutes carry no rounding
// measurement: the minutes typed are already the whole minutes GitHub
// billed. The measured rounding number comes from the real-runs check.

export const TYPED_GITHUB_PER_MINUTE_USD = { linux: 0.006, windows: 0.01, macos: 0.062 } as const;
export const TYPED_STANDARD_PER_MINUTE_USD = 0.004;
export const TYPED_RATES_PROVENANCE =
  "GitHub's published per-minute rates for standard GitHub-hosted runners - January 2026 rate card; read November 28, 2026. SolveLang Standard: $0.004/min metered per second, 10-second minimum.";

export type TypedMinutesInput = {
  linuxMinutes: number;
  windowsMinutes: number;
  macosMinutes: number;
};

export type TypedMinutesEstimate = {
  totalMinutes: number;
  github: { linuxUsd: number; windowsUsd: number; macosUsd: number; totalUsd: number };
  solvelangStandardUsd: number;
  differenceUsd: number;
};

function cleanMinutes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function priceTypedMinutes(input: TypedMinutesInput): TypedMinutesEstimate {
  const linuxMinutes = cleanMinutes(input.linuxMinutes);
  const windowsMinutes = cleanMinutes(input.windowsMinutes);
  const macosMinutes = cleanMinutes(input.macosMinutes);
  const linuxUsd = linuxMinutes * TYPED_GITHUB_PER_MINUTE_USD.linux;
  const windowsUsd = windowsMinutes * TYPED_GITHUB_PER_MINUTE_USD.windows;
  const macosUsd = macosMinutes * TYPED_GITHUB_PER_MINUTE_USD.macos;
  const totalMinutes = linuxMinutes + windowsMinutes + macosMinutes;
  const githubTotalUsd = linuxUsd + windowsUsd + macosUsd;
  const solvelangStandardUsd = totalMinutes * TYPED_STANDARD_PER_MINUTE_USD;
  return {
    totalMinutes,
    github: { linuxUsd, windowsUsd, macosUsd, totalUsd: githubTotalUsd },
    solvelangStandardUsd,
    differenceUsd: githubTotalUsd - solvelangStandardUsd,
  };
}
