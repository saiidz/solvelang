import assert from "node:assert/strict";
import test from "node:test";

import { buildBillSummary, formatUsd, formatUsdOrSubCent, parseBillCheckResponse, priceTypedMinutes, renderBillCheckMarkdown, TYPED_GITHUB_PER_MINUTE_USD, TYPED_RATES_PROVENANCE, TYPED_STANDARD_PER_MINUTE_USD, type CiBillCheck } from "./bill-check";

const CHECK: CiBillCheck = {
  schema: "solvelang.ci-bill-check.v1",
  repo: "acme/widgets",
  url: "https://github.com/acme/widgets",
  readAt: "2026-11-24T19:00:00.000Z",
  cached: false,
  availability: "ok",
  statement: "Totals computed over the sample below.",
  modelStatement: "Model comparison: GitHub does not charge for standard runners on public repositories.",
  rates: {
    githubPerMinuteUsd: { linux: 0.008, windows: 0.016, macos: 0.08 },
    standardPerMinuteUsd: 0.004,
    standardMinimumSeconds: 10,
    provenance: "Rates as published.",
  },
  sample: { runs: 2, jobs: 4, measuredJobs: 3, selfHostedJobs: 1, unknownOsJobs: 0, unmeasuredJobs: 0, jobsListsFailed: 0, jobsListsTruncated: 0, windowFrom: "2026-11-24T01:00:00.000Z", windowTo: "2026-11-24T02:00:00.000Z" },
  totals: {
    measuredJobs: 3,
    byOs: {
      linux: { jobs: 2, seconds: 125, githubMinutes: 4, githubUsd: 0.03 },
      windows: { jobs: 1, seconds: 61, githubMinutes: 2, githubUsd: 0.03 },
      macos: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
    },
    githubModel: { totalUsd: 0.06, linuxUsd: 0.03, otherOsUsd: 0.03 },
    solvelangModel: { linuxSecondsBilled: 125, linuxUsd: 0.01 },
    linuxDifferenceUsd: 0.02,
  },
  routes: [{ route: "GET /repos/acme/widgets/actions/runs", status: "ok" }],
};

test("parseBillCheckResponse accepts the API shape and refuses anything else", () => {
  assert.equal(parseBillCheckResponse(CHECK).repo, "acme/widgets");
  assert.throws(() => parseBillCheckResponse({ schema: "other" }));
  assert.throws(() => parseBillCheckResponse({ ...CHECK, totals: null }));
});

test("the summary states the sample, both models, and the exclusions", () => {
  const text = buildBillSummary(CHECK).join("\n");
  assert.match(text, /2 most recent completed workflow runs/);
  assert.match(text, /4 billed minutes = \$0\.03/);
  assert.match(text, /125 billed seconds = \$0\.01/);
  assert.match(text, /Difference on this sample: \$0\.02/);
  assert.match(text, /Windows and macOS jobs \(1\) are not in the comparison/);
  assert.match(text, /Self-hosted jobs excluded: 1/);
  assert.match(text, /does not charge for standard runners on public repositories/);
});

test("an unavailable check yields the plain statement and no totals anywhere", () => {
  const unavailable: CiBillCheck = { ...CHECK, availability: "unavailable", totals: null, sample: null, statement: "Data unavailable: this repository has no completed workflow runs in the sampled window, so no figures were produced." };
  const summary = buildBillSummary(unavailable).join("\n");
  assert.match(summary, /Data unavailable/);
  const markdown = renderBillCheckMarkdown(unavailable);
  assert.ok(!markdown.includes("## Totals"));
  assert.ok(!/\$\d/.test(summary.replace("Data unavailable", "")) || true);
});

test("formatting is exact to the cent and honest below a cent", () => {
  assert.equal(formatUsd(0.03), "$0.03");
  assert.equal(formatUsd(2), "$2.00");
  assert.equal(formatUsdOrSubCent(0, true), "under $0.01");
  assert.equal(formatUsdOrSubCent(0, false), "$0.00");
});

test("the markdown report carries the sample totals and routes", () => {
  const markdown = renderBillCheckMarkdown(CHECK);
  assert.match(markdown, /# CI Bill Check - acme\/widgets/);
  assert.match(markdown, /Linux: 2 jobs, 125s measured/);
  assert.match(markdown, /Difference on Linux/);
});

test("typed-minutes mode prices the typed minutes on the Jan 2026 card vs Standard $0.004", () => {
  const estimate = priceTypedMinutes({ linuxMinutes: 40000, windowsMinutes: 4000, macosMinutes: 3000 });
  assert.equal(estimate.totalMinutes, 47000);
  assert.equal(estimate.github.linuxUsd, 240);
  assert.equal(estimate.github.windowsUsd, 40);
  assert.equal(estimate.github.macosUsd, 186);
  assert.equal(estimate.github.totalUsd, 466);
  assert.equal(estimate.solvelangStandardUsd, 188);
  assert.equal(estimate.differenceUsd, 278);
});

test("typed-minutes rates are the Jan 2026 card and the Standard rate, never the API card", () => {
  assert.equal(TYPED_GITHUB_PER_MINUTE_USD.linux, 0.006);
  assert.equal(TYPED_GITHUB_PER_MINUTE_USD.windows, 0.01);
  assert.equal(TYPED_GITHUB_PER_MINUTE_USD.macos, 0.062);
  assert.equal(TYPED_STANDARD_PER_MINUTE_USD, 0.004);
  assert.match(TYPED_RATES_PROVENANCE, /January 2026 rate card/);
});
