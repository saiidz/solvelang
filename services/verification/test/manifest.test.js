// QA pin for the Defect 1 code fix (Nov 26, 2026 stranger proof):
// the App Manifest's permission set is locked at app creation, and
// it must request pull_requests: write — GitHub gates an app
// token's PR conversation comments on that permission (issues:
// write alone gets a 403 on PRs, proven first-hand with a freshly
// minted installation token: plain-issue comment 201, PR comment
// 403). If this set ever drops back to pull_requests: read, every
// future app created from /setup ships unable to post its receipt
// comment.
import assert from "node:assert/strict";
import test from "node:test";

import { buildManifest } from "../src/manifest.js";

test("manifest requests exactly the published permission set", () => {
  const manifest = buildManifest("https://www.solve-lang.com");
  assert.deepEqual(manifest.default_permissions, {
    checks: "write",
    contents: "read",
    issues: "write",
    metadata: "read",
    pull_requests: "write",
  });
  assert.deepEqual(manifest.default_events, ["pull_request"]);
});

test("manifest URLs derive from the public base", () => {
  const manifest = buildManifest("https://verify.example.test");
  assert.equal(manifest.hook_attributes.url, "https://verify.example.test/webhooks/github");
  assert.equal(manifest.redirect_url, "https://verify.example.test/app-manifest-callback");
  assert.equal(manifest.name, "SolveLang Verification");
  assert.equal(manifest.public, true);
});
