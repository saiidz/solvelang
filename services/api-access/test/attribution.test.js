import assert from "node:assert/strict";
import test from "node:test";

import {
  attributionAccountFields,
  normalizeAttribution,
  parseAttributionCookie,
  parseAttributionJson,
  sanitizeAttributionValue,
  serializeAttribution,
} from "../src/attribution.js";

test("sanitizeAttributionValue keeps slug-shaped tags only", () => {
  assert.equal(sanitizeAttributionValue("minutes-cost"), "minutes-cost");
  assert.equal(sanitizeAttributionValue(" solve-lang.com "), "solve-lang.com");
  assert.equal(sanitizeAttributionValue("bad tag!"), null);
  assert.equal(sanitizeAttributionValue(""), null);
  assert.equal(sanitizeAttributionValue("x".repeat(65)), null);
  assert.equal(sanitizeAttributionValue(null), null);
});

test("normalizeAttribution accepts wire and camelCase shapes, dropping unusable fields", () => {
  assert.deepEqual(
    normalizeAttribution({ utm_source: "solve-lang.com", utm_medium: "seo", utm_campaign: "minutes-cost" }),
    { utmSource: "solve-lang.com", utmMedium: "seo", utmCampaign: "minutes-cost" },
  );
  assert.deepEqual(normalizeAttribution({ utmCampaign: "reduce-bill", utm_source: "bad source!" }), { utmCampaign: "reduce-bill" });
  assert.equal(normalizeAttribution({}), undefined);
  assert.equal(normalizeAttribution("nope"), undefined);
  assert.equal(normalizeAttribution(undefined), undefined);
});

test("serialize / parse round-trips the wire shape", () => {
  const wire = serializeAttribution({ utmSource: "solve-lang.com", utmMedium: "seo", utmCampaign: "alternatives" });
  assert.equal(wire, JSON.stringify({ utm_source: "solve-lang.com", utm_medium: "seo", utm_campaign: "alternatives" }));
  assert.deepEqual(parseAttributionJson(wire), { utmSource: "solve-lang.com", utmMedium: "seo", utmCampaign: "alternatives" });
  assert.equal(parseAttributionJson("not json"), undefined);
  assert.equal(parseAttributionJson(undefined), undefined);
  assert.equal(serializeAttribution({}), undefined);
});

test("parseAttributionCookie reads only the sl_first_touch cookie", () => {
  const wire = encodeURIComponent(JSON.stringify({ utm_source: "solve-lang.com", utm_medium: "seo", utm_campaign: "self-hosted-cost" }));
  assert.deepEqual(
    parseAttributionCookie(`other=1; sl_first_touch=${wire}; sl_api_session=sess_x`),
    { utmSource: "solve-lang.com", utmMedium: "seo", utmCampaign: "self-hosted-cost" },
  );
  assert.equal(parseAttributionCookie("sl_api_session=sess_x"), undefined);
  assert.equal(parseAttributionCookie("sl_first_touch=%zz"), undefined);
  assert.equal(parseAttributionCookie(undefined), undefined);
});

test("attributionAccountFields maps the triple onto first-touch account fields", () => {
  assert.deepEqual(
    attributionAccountFields({ utmSource: "solve-lang.com", utmMedium: "seo", utmCampaign: "minutes-cost" }),
    { firstTouchSource: "solve-lang.com", firstTouchMedium: "seo", firstTouchCampaign: "minutes-cost" },
  );
  assert.deepEqual(attributionAccountFields(undefined), {});
});
