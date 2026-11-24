import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNNER_MINUTES_AUTO_RELOAD_BODY,
  RUNNER_MINUTES_AUTO_RELOAD_TITLE,
  RUNNER_MINUTES_SAVE_CARD_PATH,
} from "./runner-minutes-auto-reload";

// QA pins for the auto-reload card (root: the auto-reload helpers in
// runner-minutes-auto-reload, the AutoReloadCard component, its
// rendering on the account home, and the body sentence on the buy
// page). These pin the wiring AROUND the root build:
//
//   1. The account home renders the card beside the Runner minutes
//      card, fed with the dashboard's CSRF token.
//   2. The card drives every read and write through the shared
//      route constant — never a hand-typed endpoint — and re-reads
//      the settings after every write.
//   3. The approved title and body reach both surfaces from the
//      shared constants, verbatim.
//   4. The payment_method_required refusal routes to the existing
//      Agent Access save-card flow, and a failed reload renders as
//      a visible alert, not a quiet line.

const accountHome = readFileSync("app/account/home/AccountHome.tsx", "utf8");
const autoReloadCard = readFileSync("app/account/home/AutoReloadCard.tsx", "utf8");
const checkout = readFileSync("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx", "utf8");

test("the account home renders the Auto-reload card with the session CSRF token", () => {
  assert.ok(accountHome.includes("AutoReloadCard"), "the home imports/renders the card");
  assert.ok(
    accountHome.includes("<AutoReloadCard csrfToken={dashboard.csrfToken} />"),
    "the card is fed the dashboard CSRF token like every customer write",
  );
});

test("the card uses the shared auto-reload route for reads and writes, never a hand-typed one", () => {
  assert.ok(autoReloadCard.includes("RUNNER_MINUTES_AUTO_RELOAD_PATH"), "the card imports the shared route");
  assert.ok(!autoReloadCard.includes('"/customer/runner-minutes/auto-reload"'), "no hand-typed endpoint in the card");
  assert.ok(autoReloadCard.includes('method: "GET"'), "the card reads the settings");
  assert.ok(autoReloadCard.includes('method: "POST"'), "the card writes the settings");
});

test("the card re-reads the settings after a write — no blind local flips", () => {
  const save = autoReloadCard.indexOf("async function savePool");
  const rereadCall = autoReloadCard.indexOf("await reread()", save);
  assert.ok(save >= 0 && rereadCall > save, "savePool re-reads the service state after posting");
});

test("the approved title and body reach the card from the shared constants, verbatim", () => {
  assert.ok(autoReloadCard.includes("{RUNNER_MINUTES_AUTO_RELOAD_TITLE}"), "the card renders the shared title");
  assert.ok(autoReloadCard.includes("{RUNNER_MINUTES_AUTO_RELOAD_BODY}"), "the card renders the shared body");
  assert.equal(RUNNER_MINUTES_AUTO_RELOAD_TITLE, "Auto-reload");
  assert.equal(
    RUNNER_MINUTES_AUTO_RELOAD_BODY,
    "Keep your workflows running without interruption. Enable auto-reload and your minutes top up automatically at 85% usage — before a running job ever has to wait on balance.",
  );
});

test("the same approved body sentence appears on the buy page under the packs", () => {
  assert.ok(checkout.includes("RUNNER_MINUTES_AUTO_RELOAD_BODY"), "the checkout renders the shared body sentence");
  const packs = checkout.indexOf("RUNNER_MINUTES_CACHE_PACKS.map");
  const sentence = checkout.indexOf("{RUNNER_MINUTES_AUTO_RELOAD_BODY}");
  assert.ok(packs >= 0 && sentence > packs, "the sentence sits under the pack lists");
});

test("a payment_method_required refusal routes into the Agent Access save-card flow", () => {
  assert.ok(
    autoReloadCard.includes("runnerMinutesAutoReloadNeedsPaymentMethod(caught)"),
    "the card branches on the service's refusal code",
  );
  assert.ok(autoReloadCard.includes("RUNNER_MINUTES_SAVE_CARD_PATH"), "the card links the shared save-card route");
  assert.equal(RUNNER_MINUTES_SAVE_CARD_PATH, "/account/agent-access/");
  assert.ok(
    !autoReloadCard.includes("payment-method/setup"),
    "the card never builds its own card-collection flow",
  );
});

test("a failed reload renders as a visible alert in the card", () => {
  assert.ok(
    autoReloadCard.includes('settings.lastStatus === "failed"'),
    "the card special-cases the failed status",
  );
  assert.ok(autoReloadCard.includes('role="alert"'), "the failure is announced as an alert");
});

test("the card shows the saved card's brand and last4 when one is saved", () => {
  assert.ok(autoReloadCard.includes("runnerMinutesSavedCardLabel(savedMethod)"), "the saved card renders from the shared label");
  assert.ok(autoReloadCard.includes("runnerMinutesSavedPaymentMethod(view)"), "the saved card comes from the service view");
});
