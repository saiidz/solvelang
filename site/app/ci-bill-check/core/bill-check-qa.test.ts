import assert from "node:assert/strict";
import test from "node:test";

import { buildBillSummary, formatUsdOrSubCent, parseBillCheckResponse, renderBillCheckMarkdown, type CiBillCheck } from "./bill-check";

const BASE: CiBillCheck = {
  schema: "solvelang.ci-bill-check.v1",
  repo: "acme/widgets",
  url: "https://github.com/acme/widgets",
  readAt: "2026-11-24T19:00:00.000Z",
  cached: false,
  availability: "ok",
  statement: "Totals computed over the sample below.",
  modelStatement: "Model comparison statement.",
  rates: { githubPerMinuteUsd: { linux: 0.008, windows: 0.016, macos: 0.08 }, standardPerMinuteUsd: 0.004, standardMinimumSeconds: 10, provenance: "Rates as published." },
  sample: { runs: 1, jobs: 1, measuredJobs: 1, selfHostedJobs: 0, unknownOsJobs: 0, unmeasuredJobs: 0, jobsListsFailed: 0, jobsListsTruncated: 0, windowFrom: null, windowTo: null },
  totals: {
    measuredJobs: 1,
    byOs: {
      linux: { jobs: 1, seconds: 8, githubMinutes: 1, githubUsd: 0.01 },
      windows: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
      macos: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
    },
    githubModel: { totalUsd: 0.01, linuxUsd: 0.01, otherOsUsd: 0 },
    solvelangModel: { linuxSecondsBilled: 10, linuxUsd: 0 },
    linuxDifferenceUsd: 0.01,
  },
  routes: [{ route: "GET /repos/acme/widgets/actions/runs", status: "ok" }],
};

test("QA: a Linux-only sample produces no Windows/macOS or self-hosted lines", () => {
  const text = buildBillSummary(BASE).join("\n");
  assert.ok(!text.includes("are not in the comparison"));
  assert.ok(!text.includes("Self-hosted jobs excluded"));
  assert.match(text, /10 billed seconds = under \$0\.01/);
});

test("QA: a failed availability renders the statement and zero totals sections", () => {
  const failed: CiBillCheck = { ...BASE, availability: "failed", totals: null, sample: null, statement: "Data unavailable: the workflow-run read failed (the GitHub API answered 403). No figures were produced." };
  const markdown = renderBillCheckMarkdown(failed);
  assert.match(markdown, /Data unavailable: the workflow-run read failed/);
  assert.ok(!markdown.includes("## Totals"));
  assert.ok(!markdown.includes("$0."));
});

test("QA: sub-cent honesty only applies when work was actually billed", () => {
  assert.equal(formatUsdOrSubCent(0, true), "under $0.01");
  assert.equal(formatUsdOrSubCent(0, false), "$0.00");
  assert.equal(formatUsdOrSubCent(0.01, true), "$0.01");
});

test("QA: an ok response missing its sample renders the statement only, never figures", () => {
  const broken = { ...BASE, sample: null } as unknown as CiBillCheck;
  const lines = buildBillSummary(broken);
  assert.equal(lines[0], BASE.statement);
  assert.ok(!lines.join("\n").includes("billed minutes"));
});
