import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildChangeImpactReceipt, renderChangeImpactReceiptMarkdown } from "./receipt";
import { sampleReceiptInput } from "./sample";

// QA pins for the Change Impact Receipts page (stacked on the builder PR).
// Follows the repo convention of resolving sources from the site root
// (process.cwd() under the npm test scripts), as in app/check/core tests.
const pageSource = () => readFileSync(resolve(process.cwd(), "app/(english)/change-impact-receipt/page.tsx"), "utf8");
const appSource = () => readFileSync(resolve(process.cwd(), "app/change-impact-receipt/ChangeImpactReceiptApp.tsx"), "utf8");

test("page is a pure addition with canonical metadata and no pricing or checkout wiring", () => {
  const page = pageSource();
  assert.match(page, /change-impact-receipt\//);
  assert.doesNotMatch(page.toLowerCase(), /price|\$|checkout|stripe/);
});

test("app wires the builder and the sample, and claims stay within the evidence rules", () => {
  const app = appSource();
  assert.match(app, /buildChangeImpactReceipt/);
  assert.match(app, /sampleReceiptInput/);
  assert.match(app, /no finding is given a risk score/i);
  assert.doesNotMatch(app, /fetch\(|XMLHttpRequest/);
});

test("sample renders the same grading shape as the Nov 22 sprint receipts", () => {
  const markdown = renderChangeImpactReceiptMarkdown(buildChangeImpactReceipt(sampleReceiptInput));
  assert.match(markdown, /Confirmed \(verified\) findings/);
  assert.match(markdown, /Failed routes \/ unusable evidence/);
  assert.match(markdown, /Recorded as unverified \(not guessed\)/);
  assert.match(markdown, /espanso\/espanso — PR #2511/);
});
