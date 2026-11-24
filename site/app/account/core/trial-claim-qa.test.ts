import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { TRIAL_CLAIM_HELD_LINE, TRIAL_CLAIM_MANUAL_REVIEW_LABEL } from "./trial-claim";

const siteRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  const fullPath = path.join(siteRoot, relativePath);
  assert.equal(existsSync(fullPath), true, `${relativePath} must exist`);
  return readFile(fullPath, "utf8");
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) yield full;
  }
}

// Trial Phase 2 Gate C QA pins: the claim UI wiring in the account
// home, and the C1 collection discipline proven by code search —
// the collector is referenced by exactly the core module and the
// claim action, nowhere else in the site's non-test sources.
test("account home wires the claim card to the trial-claim route", async () => {
  const home = await source("app/account/home/AccountHome.tsx");
  assert.match(home, /from "@\/app\/account\/core\/trial-claim"/, "account home imports the claim module");
  assert.match(home, /customerApi<TrialClaimView>\(RUNNERS_API_BASE, TRIAL_CLAIM_PATH, \{ method: "GET" \}\)/, "claim state read");
  assert.match(home, /collectTrialSignals\(\)/, "claim action collects the signals");
  assert.match(home, /manualReview: true/, "manual-review route is offered in-product (C8)");
  assert.match(home, /csrfToken: dashboard\.csrfToken/, "claim submit is CSRF-gated like every customer write");
  assert.match(home, /trialClaimScreen\(claimView\)/, "card renders from the reported claim state");
  assert.match(home, /TRIAL_CLAIM_HEADING/, "SS7.4 heading rendered");
  assert.match(home, /TRIAL_CLAIM_BODY/, "SS7.4 explanation rendered before the check runs");
  assert.match(home, /TRIAL_CLAIM_ALTERNATIVES/, "SS7.4 alternatives line rendered");
  assert.match(home, /\/account\/runner-minutes-checkout\//, "purchase route linked from the claim card");
});

test("the collector is referenced only by the claim module and the claim action (C1)", async () => {
  const appDir = path.join(siteRoot, "app");
  const referencing: string[] = [];
  for (const file of walk(appDir)) {
    const text = readFileSync(file, "utf8");
    if (text.includes("collectTrialSignals")) {
      referencing.push(path.relative(siteRoot, file).split(path.sep).join("/"));
    }
  }
  assert.deepEqual(referencing.sort(), [
    "app/account/core/trial-claim.ts",
    "app/account/home/AccountHome.tsx",
  ]);
});

test("the held notice keeps the hold-never-deny promise (C7)", () => {
  assert.ok(TRIAL_CLAIM_HELD_LINE.includes("Nothing is finally refused automatically"));
  assert.ok(TRIAL_CLAIM_HELD_LINE.includes("reviewed by a person"));
  assert.equal(TRIAL_CLAIM_MANUAL_REVIEW_LABEL, "Request a manual review instead");
});
