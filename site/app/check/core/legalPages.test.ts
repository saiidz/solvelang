import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const siteRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  const fullPath = path.join(siteRoot, relativePath);
  assert.equal(existsSync(fullPath), true, `${relativePath} must exist`);
  return readFile(fullPath, "utf8");
}

test("Terms and Refund Policy pages contain their required customer-facing headings", async () => {
  const [terms, refundPolicy] = await Promise.all([
    source("app/terms/page.tsx"),
    source("app/refund-policy/page.tsx"),
  ]);

  for (const heading of ["Terms of Use", "Automated outputs and customer review", "Payments and immediate digital performance", "Limitation of liability"]) {
    assert.match(terms, new RegExp(heading));
  }
  for (const heading of ["Refund Policy", "When refunds may be available", "When refunds are generally not available", "EU and EEA consumer information"]) {
    assert.match(refundPolicy, new RegExp(heading));
  }
  assert.match(terms, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(refundPolicy, /mandatory consumer rights remain unaffected/i);
});

test("the public sitemap and legal navigation include both legal routes", async () => {
  const [sitemap, landing, checkout, privacy, support] = await Promise.all([
    source("public/sitemap.xml"),
    source("app/landing/page.tsx"),
    source("app/checkout/PaymentElementClient.tsx"),
    source("app/preflight-privacy/page.tsx"),
    source("app/support/page.tsx"),
  ]);

  for (const sourceText of [sitemap, landing, checkout, privacy, support]) {
    assert.match(sourceText, /\/terms\//);
    assert.match(sourceText, /\/refund-policy\//);
  }
});

test("checkout renders an unchecked accessible clickwrap before loading verification", async () => {
  const [checkout, checkoutTerms, entitlementTerms] = await Promise.all([
    source("app/checkout/PaymentElementClient.tsx"),
    source("app/checkout/checkoutGate.ts"),
    readFile(path.join(siteRoot, "../services/entitlements/src/terms.ts"), "utf8"),
  ]);

  assert.match(checkout, /type="checkbox"/);
  assert.match(checkout, /checked=\{termsAccepted\}/);
  assert.match(checkout, /htmlFor="checkout-terms-consent"/);
  assert.match(checkout, /termsAccepted && turnstileSiteKey/);
  assert.match(checkout, /termsAccepted: true/);
  assert.match(checkout, /termsVersion: TERMS_VERSION/);
  assert.match(checkoutTerms, /export const TERMS_VERSION = "2026-07-26"/);
  assert.match(entitlementTerms, /export const TERMS_VERSION = "2026-07-26"/);
});
