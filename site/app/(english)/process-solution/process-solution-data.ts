export type ProcessStep = {
  title: string;
  body: string;
};

export type LandingOutcome = {
  tone: "green" | "red";
  heading: string;
  body: string;
};

export type AuditStat = {
  value: string;
  label: string;
  note: string;
};

export const processSteps: ProcessStep[] = [
  {
    title: "Install the app",
    body: "One GitHub App install on your org. Minutes. Nothing else to set up.",
  },
  {
    title: "Set the rules",
    body: "Plain lines in merge-rules.solve. Most teams start from our proven template and adjust the caps to their queue.",
  },
  {
    title: "PR opens, cheap tier",
    body: "Fast checks run at once on your runners. No full battery is burned on a pull request that has not earned it yet.",
  },
  {
    title: "Queue builds the combined tree",
    body: "The control plane builds the exact tree that will land — base plus batch together — instead of testing each pull request against a base it will never meet.",
  },
  {
    title: "One battery, capped shards",
    body: "One full run on that combined tree, split into at most six shards. Any shard can run on any free runner you own.",
  },
];

export const landingOutcomes: LandingOutcome[] = [
  {
    tone: "green",
    heading: "Green — the exact tested tree merges",
    body: "On FULL GREEN, the tree that lands is the tree that was tested — the same commits, the same combination. Nothing merges that was not itself tested.",
  },
  {
    tone: "red",
    heading: "Red — the batch is bisected",
    body: "The system splits the batch, finds the one guilty pull request, and ejects it to its author with the reason. The innocent pull requests still land.",
  },
];

export const auditStats: AuditStat[] = [
  {
    value: "34.3",
    label: "CI job-hours per merged PR",
    note: "2,365.8 job-hours across 69 merges — the waste this product attacks.",
  },
  {
    value: "42.4%",
    label: "of all CI time was queue wait",
    note: "Machines idle, pull requests stuck — capacity spent on waiting, not testing.",
  },
  {
    value: "15 → ~1",
    label: "full test runs for a 5-link chain",
    note: "15 runs the old way — L(L+1)/2 for chain length L — versus about one run per landing batch.",
  },
  {
    value: "0.3–0.5",
    label: "target test runs per landed PR",
    note: "The scoreboard target with batching. Stated as a target, not as a result.",
  },
];

export const rulesLines: string[] = [
  "stack ≤ 6 files",
  "shards ≤ 6 per PR · ≤ 6 per landing tree",
  "batch 3 — 5 only when failures drop under 10%",
  "gate FULL GREEN only",
  "fleet your own runners only · any runner, any shard",
];

export const scoreboardMetrics: string[] = [
  "merges per day",
  "job-hours per merged PR",
  "runs per landed PR",
  "queue-wait share",
  "fleet state",
];
