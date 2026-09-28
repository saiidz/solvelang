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
  const [terms, refundPolicy, legalContent, canonicalLegalContent] = await Promise.all([
    source("app/(english)/terms/page.tsx"),
    source("app/(english)/refund-policy/page.tsx"),
    source("app/legal-content.json"),
    readFile(path.join(siteRoot, "../services/entitlements/src/legal-content.json"), "utf8"),
  ]);
  assert.equal(legalContent, canonicalLegalContent, "the build-local legal artifact must match the canonical entitlement contract exactly");

  for (const heading of ["Terms of Use", "Automated outputs and customer review", "Workflow Preflight payments and immediate digital performance", "Consumer remedies and business liability"]) {
    assert.match(`${terms}\n${legalContent}`, new RegExp(heading));
  }
  for (const heading of ["Refund Policy", "When refunds may be available", "When refunds are generally not available", "EU and EEA consumer information"]) {
    assert.match(`${refundPolicy}\n${legalContent}`, new RegExp(heading));
  }
  assert.match(terms, /legalContent/);
  assert.match(refundPolicy, /legalContent/);
  assert.match(legalContent, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(legalContent, /2026-09-27-v3/);
  assert.match(legalContent, /API subscriptions renew monthly until canceled/);
  assert.match(legalContent, /API subscription cancellation and refunds/);
  assert.match(legalContent, /does not automatically refund/);
  assert.doesNotMatch(legalContent, /Production checkout remains blocked/);
  assert.match(legalContent, /mandatory consumer rights remain unaffected/i);
});

test("the public sitemap and legal navigation include the legal and withdrawal routes", async () => {
  const [routeRegistry, sitemap, landing, checkout, privacy, support] = await Promise.all([
    source("app/i18n/routes.ts"),
    source("app/sitemap.ts"),
    source("app/(english)/landing/page.tsx"),
    source("app/checkout/PaymentElementClient.tsx"),
    source("app/(english)/preflight-privacy/page.tsx"),
    source("app/(english)/support/page.tsx"),
  ]);

  assert.match(routeRegistry, /segment: "terms".*sitemap: true/);
  assert.match(routeRegistry, /segment: "refund-policy".*sitemap: true/);
  assert.match(sitemap, /sitemapEntries/);
  for (const sourceText of [landing, checkout, privacy, support]) {
    assert.match(sourceText, /\/terms\//);
    assert.match(sourceText, /\/refund-policy\//);
  }
  assert.match(`${routeRegistry}\n${sitemap}`, /withdraw/);
  assert.match(landing, /\/withdraw\//);
});

test("API pricing and account copy preserve the shared billing boundary and current subscription terms", async () => {
  const [apiPricing, pricing, billing, checkout, subscription, capabilities] = await Promise.all([
    source("app/(english)/api-pricing/page.tsx"),
    source("app/(english)/pricing/page.tsx"),
    source("app/(english)/billing/page.tsx"),
    source("app/account/api-checkout/EmbeddedApiCheckout.tsx"),
    source("app/account/api-subscription/SubscriptionManager.tsx"),
    source("app/product-capabilities.ts"),
  ]);
  for (const page of [apiPricing, pricing, billing]) assert.match(page, /\{billingAvailability\}/);
  assert.match(capabilities, /first real-payment canary is still pending/);
  assert.match(apiPricing, /weighted credits per UTC calendar month/);
  assert.match(apiPricing, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(apiPricing, /href="\/refund-policy\/"/);
  assert.match(pricing, /href="\/api-pricing\/"/);
  assert.doesNotMatch(pricing, /API Starter|\$79|API Growth|Subscribe to Pro/);
  assert.match(billing, /Developer is \$49\/month, Pro is \$199\/month, and Business is \$699\/month/);
  assert.match(billing, /Scheduling cancellation does not automatically refund/);
  assert.match(checkout, /Stripe shows the final total, including any applicable tax, before payment/);
  assert.match(checkout, /href="\/terms\/"/);
  assert.match(subscription, /Scheduling cancellation stops renewal at the current period end/);
  assert.doesNotMatch(subscription, /apply immediately in the sandbox/);
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
  assert.match(checkout, /I have read and agree to the Terms of Use and Refund Policy, version \{TERMS_VERSION\}\./);
  assert.match(checkout, /I expressly request that SolveLang begin performing and delivering the digital service immediately, before the withdrawal period expires\./);
  assert.match(checkout, /checkoutRequirementsMet && turnstileSiteKey/);
  assert.match(checkout, /termsAccepted: true/);
  assert.match(checkout, /immediatePerformanceRequested: true/);
  assert.match(checkout, /withdrawalAcknowledged: true/);
  assert.match(checkout, /Pay \$49 and start Workflow Preflight/);
  assert.match(checkout, /VAT and final tax treatment require operator confirmation before production checkout is enabled\./);
  assert.match(checkout, /termsVersion: TERMS_VERSION/);
  assert.match(checkoutTerms, /export const TERMS_VERSION = legalContent\.termsVersion/);
  assert.match(entitlementTerms, /legal-content\.json/);
});

test("Romanian legal routes, withdrawal flow, and current ANPC SAL asset are present", async () => {
  const [withdraw, romanianLegal, localizedPage, landing, sitemap] = await Promise.all([
    source("app/(english)/withdraw/page.tsx"),
    source("app/i18n/romanianLegal.tsx"),
    source("i18n-preview-source/[locale]/[[...route]]/page.tsx"),
    source("app/(english)/landing/page.tsx"),
    source("app/sitemap.ts"),
  ]);
  assert.match(romanianLegal, /verificare juridica si a proprietarului/);
  assert.match(localizedPage, /RomanianLegalDraft/);
  assert.equal(existsSync(path.join(siteRoot, "app/ro")), false);
  assert.doesNotMatch(sitemap, /\/ro\/(terms|refund-policy|preflight-privacy|withdraw)\//);
  assert.match(withdraw, /WithdrawalRequestClient/);
  assert.match(landing, /anpc-sal-pictogram\.png/);
  assert.match(landing, /https:\/\/reclamatiisal\.anpc\.ro/);
  assert.equal(existsSync(path.join(siteRoot, "public/anpc-sal-pictogram.png")), true);
});
