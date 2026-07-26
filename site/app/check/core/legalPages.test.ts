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

  for (const heading of ["Terms of Use", "Automated outputs and customer review", "Payments and immediate digital performance", "Consumer remedies and business liability"]) {
    assert.match(terms, new RegExp(heading));
  }
  for (const heading of ["Refund Policy", "When refunds may be available", "When refunds are generally not available", "EU and EEA consumer information"]) {
    assert.match(refundPolicy, new RegExp(heading));
  }
  assert.match(terms, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(refundPolicy, /mandatory consumer rights remain unaffected/i);
});

test("the public sitemap and legal navigation include the legal and withdrawal routes", async () => {
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
  assert.match(sitemap, /\/withdraw\//);
  assert.match(landing, /\/withdraw\//);
});

test("checkout requires both unchecked accessible clickwrap statements before loading verification", async () => {
  const [checkout, checkoutTerms, entitlementTerms] = await Promise.all([
    source("app/checkout/PaymentElementClient.tsx"),
    source("app/checkout/checkoutGate.ts"),
    readFile(path.join(siteRoot, "../services/entitlements/src/terms.ts"), "utf8"),
  ]);

  assert.match(checkout, /type="checkbox"/);
  assert.match(checkout, /checked=\{termsAccepted\}/);
  assert.match(checkout, /checked=\{immediatePerformanceRequested\}/);
  assert.match(checkout, /htmlFor="checkout-terms-consent"/);
  assert.match(checkout, /htmlFor="checkout-immediate-performance-consent"/);
  assert.match(checkout, /I have read and agree to the Terms of Use and Refund Policy, version 2026-07-26-v2\./);
  assert.match(checkout, /I expressly request that SolveLang begin performing and delivering the digital service immediately, before the withdrawal period expires\./);
  assert.match(checkout, /checkoutRequirementsMet && turnstileSiteKey/);
  assert.match(checkout, /termsAccepted: true/);
  assert.match(checkout, /immediatePerformanceRequested: true/);
  assert.match(checkout, /withdrawalAcknowledged: true/);
  assert.match(checkout, /Pay \$49 and start Workflow Preflight/);
  assert.match(checkout, /VAT and final tax treatment require operator confirmation before production checkout is enabled\./);
  assert.match(checkout, /termsVersion: TERMS_VERSION/);
  assert.match(checkoutTerms, /export const TERMS_VERSION = "2026-07-26-v2"/);
  assert.match(entitlementTerms, /export const TERMS_VERSION = "2026-07-26-v2"/);
});

test("Romanian legal routes, withdrawal flow, and current ANPC SAL asset are present", async () => {
  const [withdraw, roTerms, roRefund, roPrivacy, roWithdraw, landing] = await Promise.all([
    source("app/withdraw/page.tsx"),
    source("app/ro/terms/page.tsx"),
    source("app/ro/refund-policy/page.tsx"),
    source("app/ro/preflight-privacy/page.tsx"),
    source("app/ro/withdraw/page.tsx"),
    source("app/landing/page.tsx"),
  ]);
  for (const sourceText of [roTerms, roRefund, roPrivacy, roWithdraw]) assert.match(sourceText, /verificare juridica si a proprietarului/);
  assert.match(withdraw, /WithdrawalRequestClient/);
  assert.match(landing, /anpc-sal-pictogram\.png/);
  assert.match(landing, /https:\/\/reclamatiisal\.anpc\.ro/);
  assert.equal(existsSync(path.join(siteRoot, "public/anpc-sal-pictogram.png")), true);
});
