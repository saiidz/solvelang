import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(siteRoot, "out");
const english = await readFile(path.join(outRoot, "index.html"), "utf8");
assert.match(english, /^<!DOCTYPE html><html lang="en" dir="ltr"/);

const draftPreview = process.env.I18N_DRAFT_PREVIEW === "true";
const publishedSegments = ["ro", "fr", "de", "es", "it", "pt-br", "nl", "pl", "cs", "tr", "ar", "he", "ru", "uk", "zh-hans", "zh-hant", "ja", "ko", "hi", "id", "vi", "th", "sv", "da", "no", "fi", "el"];
const rootEntries = new Set(await readdir(outRoot));

if (!draftPreview) {
  for (const segment of publishedSegments) assert.equal(rootEntries.has(segment), false, `Draft route /${segment}/ was exported.`);
} else {
  for (const segment of publishedSegments) {
    const html = await readFile(path.join(outRoot, segment, "index.html"), "utf8");
    const code = segment === "pt-br" ? "pt-BR" : segment === "zh-hans" ? "zh-Hans" : segment === "zh-hant" ? "zh-Hant" : segment;
    const direction = segment === "ar" || segment === "he" ? "rtl" : "ltr";
    assert.match(html, new RegExp(`^<!DOCTYPE html><html lang="${code}" dir="${direction}"`));
    assert.match(html, /Internal draft preview/);
    assert.match(html, /noindex/);
  }
}

console.log(`Verified exported document languages (${draftPreview ? "draft preview" : "production"}).`);
