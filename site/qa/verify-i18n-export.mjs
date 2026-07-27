import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(siteRoot, "out");
const english = await readFile(path.join(outRoot, "index.html"), "utf8");
assert.match(english, /^<!DOCTYPE html><html lang="en" dir="ltr"/);
assert.match(english, /<title>SolveLang — See the System Before You Automate It<\/title>/);
assert.doesNotMatch(english, /SolveLang \| SolveLang/);
const support = await readFile(path.join(outRoot, "support", "index.html"), "utf8");
assert.match(support, /<title>Workflow Preflight Support \| SolveLang<\/title>/);
assert.doesNotMatch(support, /Support \| SolveLang \| SolveLang/);
const sitemap = await readFile(path.join(outRoot, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /\/(?:ro|fr|de|es|it|pt-br|nl|pl|cs|tr|ar|he|ru|uk|zh-hans|zh-hant|ja|ko|hi|id|vi|th|sv|da|no|fi|el)\//);
assert.doesNotMatch(support, /hreflang="ro"/);

const draftPreview = process.env.I18N_DRAFT_PREVIEW === "true";
const publishedSegments = ["ro", "fr", "de", "es", "it", "pt-br", "nl", "pl", "cs", "tr", "ar", "he", "ru", "uk", "zh-hans", "zh-hant", "ja", "ko", "hi", "id", "vi", "th", "sv", "da", "no", "fi", "el"];
const rootEntries = new Set(await readdir(outRoot));

if (!draftPreview) {
  for (const segment of publishedSegments) assert.equal(rootEntries.has(segment), false, `Draft route /${segment}/ was exported.`);
} else {
  let previewRouteCount = 0;
  for (const segment of publishedSegments) {
    const html = await readFile(path.join(outRoot, segment, "index.html"), "utf8");
    const code = segment === "pt-br" ? "pt-BR" : segment === "zh-hans" ? "zh-Hans" : segment === "zh-hant" ? "zh-Hant" : segment;
    const direction = segment === "ar" || segment === "he" ? "rtl" : "ltr";
    assert.match(html, new RegExp(`^<!DOCTYPE html><html lang="${code}" dir="${direction}"`));
    assert.match(html, /Internal draft preview/);
    assert.match(html, /noindex/);
    const entries = await readdir(path.join(outRoot, segment), { recursive: true });
    previewRouteCount += entries.filter((entry) => entry.endsWith("index.html")).length;
  }
  assert.equal(previewRouteCount, 432);
  const romanianTerms = await readFile(path.join(outRoot, "ro", "terms", "index.html"), "utf8");
  assert.match(romanianTerms, /verificare juridica si a proprietarului/);
  assert.match(romanianTerms, /UPCOMINGSOUNDS S\.R\.L\./);
}

console.log(`Verified exported document languages (${draftPreview ? "draft preview" : "production"}).`);
