import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRecoveryPresentation } from "./recovery";

test("corrupt recovery copy offers download and an accurate export-reset confirmation", () => {
  const presentation = getRecoveryPresentation("corrupt", true);
  assert.equal(presentation.showDownload, true);
  assert.equal(presentation.resetLabel, "Export & reset corrupt data");
  assert.match(presentation.confirmation, /download/i);
  assert.match(presentation.confirmation, /permanently remove/i);
});

test("missing recovery copy offers reset without claiming export or download", () => {
  const presentation = getRecoveryPresentation("corrupt", false);
  assert.equal(presentation.showDownload, false);
  assert.equal(presentation.resetLabel, "Reset corrupt data");
  assert.doesNotMatch(presentation.resetLabel, /export|download/i);
  assert.match(presentation.warning, /could not be copied/i);
  assert.match(presentation.warning, /full or unavailable/i);
  assert.doesNotMatch(presentation.confirmation, /was downloaded/i);
  assert.match(presentation.confirmation, /permanently remove/i);
});

test("blocked replacement save offers a truthful retry action", () => {
  const presentation = getRecoveryPresentation("replacement-save-blocked", false);
  assert.equal(presentation.showDownload, false);
  assert.equal(presentation.resetLabel, "Retry workspace setup");
  assert.match(presentation.warning, /corrupt data was removed/i);
  assert.doesNotMatch(presentation.confirmation, /download|export/i);
});

test("desktop and mobile navigation expose the same semantic active-view contract", () => {
  const source = readFileSync("app/studio/StudioApp.tsx", "utf8");
  const contracts = source.match(/aria-current=\{activeView === view\.id \? "page" : undefined\}/g) ?? [];
  assert.equal(contracts.length, 2);
  assert.match(source, /<nav aria-label="Studio navigation">/);
  assert.match(source, /<nav className=\{styles\.mobileTabs\} aria-label="Studio views">/);
});

test("autosave and pagehide persistence pause while recovery is active", () => {
  const source = readFileSync("app/studio/StudioApp.tsx", "utf8");
  const recoveryGuards = source.match(/recoveryStage !== "none"/g) ?? [];
  assert.ok(recoveryGuards.length >= 3);
});
