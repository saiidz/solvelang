import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const siteRoot = process.cwd();
const source = (relativePath: string) => readFile(path.join(siteRoot, relativePath), "utf8");

test("production locale generation has no sentinel and preview remains the only draft access path", async () => {
  const localizedPage = await source("i18n-preview-source/[locale]/[[...route]]/page.tsx");
  assert.doesNotMatch(localizedPage, /i18n_disabled/);
  assert.doesNotMatch(localizedPage, /Localized routes are not published/);
  assert.match(localizedPage, /productionLocalizedParams\(\)/);
});

test("country hints use the single optional documented public endpoint variable", async () => {
  const [layout, documentation] = await Promise.all([
    source("app/(english)/layout.tsx"),
    readFile(path.join(siteRoot, "../docs/country-hint.md"), "utf8"),
  ]);
  assert.match(layout, /process\.env\.NEXT_PUBLIC_COUNTRY_HINT_ENDPOINT/);
  assert.doesNotMatch(layout, /process\.env\.I18N_COUNTRY_HINT_ENDPOINT/);
  assert.match(documentation, /NEXT_PUBLIC_COUNTRY_HINT_ENDPOINT/);
});

test("metadata titles rely on the root template without duplicating the SolveLang suffix", async () => {
  const [layout, home, support, checkout, localizedPage] = await Promise.all([
    source("app/(english)/layout.tsx"),
    source("app/(english)/page.tsx"),
    source("app/(english)/support/page.tsx"),
    source("app/(english)/checkout/page.tsx"),
    source("i18n-preview-source/[locale]/[[...route]]/page.tsx"),
  ]);
  assert.match(layout, /template: "%s \| SolveLang"/);
  assert.match(home, /absolute:/);
  assert.doesNotMatch(support, /title: "[^"]*(?:\||—) SolveLang"/);
  assert.doesNotMatch(checkout, /title: "[^"]*(?:\||—) SolveLang"/);
  assert.doesNotMatch(localizedPage, /title: `\$\{routeTitle\(route, dictionary\)\} \| SolveLang`/);
});

test("Romanian legal drafts live only in the canonical locale architecture", async () => {
  const [localizedPage, romanianLegal, locales] = await Promise.all([
    source("i18n-preview-source/[locale]/[[...route]]/page.tsx"),
    source("app/i18n/romanianLegal.tsx"),
    source("app/i18n/locales.ts"),
  ]);
  assert.equal(existsSync(path.join(siteRoot, "app/ro")), false);
  assert.match(localizedPage, /RomanianLegalDraft/);
  assert.match(romanianLegal, /verificare juridica si a proprietarului/);
  assert.match(romanianLegal, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(romanianLegal, /confirmata pe suport durabil/);
  assert.match(locales, /code: "ro"[^\n]*\.\.\.draft/);
});
