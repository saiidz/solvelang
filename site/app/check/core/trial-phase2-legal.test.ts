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

// Trial Phase 2 Gate B pins (privacy assessment SS7): the transparency
// texts must be live in the site sources before the first claim is
// processed (C13). Every assertion here fails against the pre-Phase-2
// tree and passes once the Gate B texts ship.
test("privacy policy carries the Phase 2 trial section, retention row and cookie sentence", async () => {
  const privacy = await source("app/(english)/privacy-policy/page.tsx");
  // SS7.1 section, inserted after "Payments, accounts and optional services"
  const paymentsAt = privacy.indexOf("Payments, accounts and optional services");
  const trialAt = privacy.indexOf("Free trials and abuse prevention");
  assert.ok(paymentsAt >= 0, "payments section present");
  assert.ok(trialAt > paymentsAt, "trial section follows the payments section");
  for (const phrase of [
    "one trial per person or legal entity",
    "a coded identifier derived from your device and browser characteristics",
    "a coded identifier derived from your network (IP) address",
    "We do not store your raw device details",
    "They are still personal data, and we treat them that way",
    "We keep them for 12 months from the claim, then delete them",
    "A claim is never finally refused by a computer alone",
    "buying any pack activates your account immediately",
    "object to this processing, or request erasure at hello@solve-lang.com",
  ]) {
    assert.ok(privacy.includes(phrase), `privacy section phrase: ${phrase}`);
  }
  // SS7.2 retention row
  assert.ok(
    privacy.includes('"Trial abuse-prevention coded identifiers (device and network hashes, claim records)", "12 months from the trial claim, then deleted."'),
    "retention row for the security store",
  );
  // SS7.3 cookie sentence
  for (const phrase of [
    "SolveLang uses only the cookies and similar storage that are strictly necessary to deliver and secure the services you request, and we do not use analytics or marketing cookies.",
    "we also read a small set of device and browser characteristics to create the coded identifier",
    "That check runs only when you claim a trial, and it is used only to prevent trial abuse.",
  ]) {
    assert.ok(privacy.includes(phrase), `cookie sentence phrase: ${phrase}`);
  }
  assert.ok(!privacy.includes("SolveLang currently uses only the cookies"), "old cookie wording replaced");
});

test("terms carry the Phase 2 claim sentence and the v5 version in both legal copies", async () => {
  const [siteCopy, canonicalCopy] = await Promise.all([
    source("app/legal-content.json"),
    readFile(path.join(siteRoot, "../services/entitlements/src/legal-content.json"), "utf8"),
  ]);
  assert.equal(siteCopy, canonicalCopy, "legal copies stay byte-identical");
  const parsed = JSON.parse(siteCopy) as { termsVersion: string; terms: [string, string[]][] };
  assert.equal(parsed.termsVersion, "2026-11-22-v5");
  const tokens = parsed.terms.find(([heading]) => heading === "Tokens, credits, entitlements, and requests");
  assert.ok(tokens, "tokens section present");
  const trialParagraph = tokens[1].find((p) => p.includes("One trial per person/legal entity"));
  assert.ok(trialParagraph, "trial paragraph present");
  assert.ok(
    trialParagraph.endsWith(
      "Trial activation requires claiming the trial in a signed-in SolveLang account, and we may run device and network checks, as described in the Privacy Policy, to enforce the one-trial rule.",
    ),
    "SS7.5 sentence closes the trial paragraph",
  );
});

test("homepage trial line is reconciled with claim activation (SS7.6)", async () => {
  const landing = await source("app/components/homepage/LandingPage.tsx");
  assert.ok(
    landing.includes("Start with 300 free Standard minutes: they are added when you connect GitHub and claim them in your account"),
    "reconciled homepage trial line",
  );
  assert.ok(!landing.includes("added automatically when you connect GitHub"), "old automatic wording gone");
});
