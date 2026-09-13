import assert from "node:assert/strict";
import test from "node:test";
import { serializeJsonLd } from "../app/components/jsonLdSerializer.mjs";

test("JSON-LD serialization cannot terminate or alter the surrounding script", () => {
  const hostile = "</script><script>alert('jsonld-xss')</script>&\u2028\u2029";
  const serialized = serializeJsonLd({ name: hostile });

  assert.doesNotMatch(serialized, /<\/?script/i);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/);
  assert.equal(JSON.parse(serialized).name, hostile);
});

test("JSON-LD serialization remains valid for ordinary structured data", () => {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SolveLang",
  };

  assert.deepEqual(JSON.parse(serializeJsonLd(data)), data);
  assert.equal(serializeJsonLd(undefined), "null");
});
