// Connected repositories and auto-run state for the account GitHub
// page (zero-step onboarding, S5c) — pure data shaping, no fetch, no
// window, so the public QA suite can pin the shapes directly.
//
// Two services feed the section, and both shapes are contracts built
// alongside this surface; treat them as fixed:
//
//   GET /customer/github/bindings (api-access, session cookie)
//     -> { connected: boolean,
//          installations: [{ accountLogin, state }],
//          repositories: [{ fullName, installationId }] }
//     A 503 or any error means the bindings service is not there yet;
//     the page treats that exactly like "not connected" (the caller
//     normalizes null in that case) and never shows an error dump.
//
//   GET /customer/runner-minutes/account (runners service, same
//   session-cookie pattern as the runner-minutes checkout)
//     -> the account view, which gains an autoRun block:
//          autoRun: { jobsServed, minutesUsed, secondsUsed,
//                     recentServes: [{ repository, jobId, minutes,
//                                      lane, outcome,
//                                      ranOnSolveLangRunner, at }] }
//        and a top-level status ("active" | "paused"); an absent
//        status means active. An older service sends no autoRun at
//        all — the view then carries autoRun: null and the section
//        renders without totals rather than inventing numbers.

export type GitHubBindingsAccount = {
  login: string;
  state: string;
};

export type GitHubBindingsRepository = {
  fullName: string;
  installationId: number | null;
};

export type GitHubBindingsView = {
  connected: boolean;
  accounts: GitHubBindingsAccount[];
  repositories: GitHubBindingsRepository[];
};

export const NOT_CONNECTED_BINDINGS: GitHubBindingsView = {
  connected: false,
  accounts: [],
  repositories: [],
};

export type RunnerMinutesAutoRunServe = {
  repository: string;
  jobId: string;
  minutes: number | null;
  lane: string;
  outcome: string;
  ranOnSolveLangRunner: boolean;
  at: string;
};

export type RunnerMinutesAutoRun = {
  jobsServed: number | null;
  minutesUsed: number | null;
  secondsUsed: number | null;
  recentServes: RunnerMinutesAutoRunServe[];
};

export type RunnerMinutesAccountView = {
  status: "active" | "paused";
  autoRun: RunnerMinutesAutoRun | null;
};

export const DEFAULT_RUNNER_MINUTES_ACCOUNT: RunnerMinutesAccountView = {
  status: "active",
  autoRun: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function serveTime(serve: RunnerMinutesAutoRunServe): number {
  const parsed = Date.parse(serve.at);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function normalizeGitHubBindings(raw: unknown): GitHubBindingsView {
  const root = asRecord(raw);
  if (root.connected !== true) return { ...NOT_CONNECTED_BINDINGS };
  const accounts = asArray(root.installations)
    .map((item) => {
      const entry = asRecord(item);
      return { login: asText(entry.accountLogin), state: asText(entry.state) };
    })
    .filter((account) => account.login !== "");
  const repositories = asArray(root.repositories)
    .map((item) => {
      const entry = asRecord(item);
      return { fullName: asText(entry.fullName), installationId: asNumber(entry.installationId) };
    })
    .filter((repository) => repository.fullName !== "");
  return { connected: true, accounts, repositories };
}

export function normalizeRunnerMinutesAccount(raw: unknown): RunnerMinutesAccountView {
  const root = asRecord(raw);
  const status = root.status === "paused" ? "paused" : "active";
  if (!("autoRun" in root)) return { status, autoRun: null };
  const autoRunRaw = asRecord(root.autoRun);
  if (Object.keys(autoRunRaw).length === 0) return { status, autoRun: null };
  const recentServes = asArray(autoRunRaw.recentServes)
    .map((item) => {
      const entry = asRecord(item);
      const jobId = entry.jobId;
      return {
        repository: asText(entry.repository),
        jobId: typeof jobId === "number" && Number.isFinite(jobId) ? String(jobId) : asText(jobId),
        minutes: asNumber(entry.minutes),
        lane: asText(entry.lane),
        outcome: asText(entry.outcome),
        ranOnSolveLangRunner: entry.ranOnSolveLangRunner === true,
        at: asText(entry.at),
      };
    })
    .filter((serve) => serve.repository !== "")
    .sort((a, b) => serveTime(b) - serveTime(a));
  return {
    status,
    autoRun: {
      jobsServed: asNumber(autoRunRaw.jobsServed),
      minutesUsed: asNumber(autoRunRaw.minutesUsed),
      secondsUsed: asNumber(autoRunRaw.secondsUsed),
      recentServes,
    },
  };
}
