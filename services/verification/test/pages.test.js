// QA pins for the verification service's public pages: the redesign
// (src/pages.js) must keep the manifest form contract byte-for-byte
// (action, state, hidden field, escaping), the published permission
// wording verbatim, and the solve-lang.com design tokens and logo
// artwork in every rendered page.
import assert from "node:assert/strict";
import test from "node:test";

import {
  renderManifestCallbackFailurePage,
  renderManifestCallbackMissingCodePage,
  renderManifestCallbackSuccessPage,
  renderSetupAppCreatedPage,
  renderSetupCreatePage,
} from "../src/pages.js";

const STATE = "0123456789abcdef0123456789abcdef";
const MANIFEST = JSON.stringify({
  name: "SolveLang Verification",
  default_permissions: {
    checks: "write",
    contents: "read",
    issues: "write",
    metadata: "read",
    pull_requests: "read",
  },
  default_events: ["pull_request"],
});

function assertDesignSystem(page) {
  // Token palette from site/app/globals.css (dark default theme).
  assert.ok(page.includes("--canvas: #0a0e1a"), "canvas token");
  assert.ok(page.includes("--panel: #16203a"), "panel token");
  assert.ok(page.includes("--panel-inset: #0d1526"), "panel-inset token");
  assert.ok(page.includes("--line: #26314d"), "line token");
  assert.ok(page.includes("--ink: #e6edf3"), "ink token");
  assert.ok(page.includes("--body-text: #c9d1d9"), "body text token");
  assert.ok(page.includes("--muted: #8b949e"), "muted token");
  assert.ok(page.includes("--accent: #58a6ff"), "accent token");
  assert.ok(page.includes("--accent-solid: #1f6feb"), "accent-solid token");
  assert.ok(page.includes("--chrome-bg: #ffffff"), "chrome token");
  // The real logo artwork (site/public/solvelang-logo.svg), inlined —
  // never the logo typeset as text.
  assert.ok(
    page.includes("SolveLang wordmark with the approved triangular maze emblem"),
    "header logo artwork"
  );
  assert.ok(page.includes('viewBox="0 0 600 124"'), "header logo geometry");
  assert.ok(page.includes("#071B36"), "logo navy gradient stop");
  assert.ok(page.includes("#1768FF"), "logo blue gradient stop");
  assert.ok(page.includes('id="mvn"') && page.includes("url(#mvb)"), "card mark artwork");
  // Site chrome: white header bar, legal footer.
  assert.ok(page.includes('class="site-header"'), "site header");
  assert.ok(page.includes('class="site-footer"'), "site footer");
  assert.ok(page.includes("Operator: UPCOMINGSOUNDS S.R.L."), "footer operator line");
  assert.ok(page.includes("hello@solve-lang.com"), "footer contact");
  // Self-contained: no scripts, no external stylesheets, favicon is a
  // data URI — the page makes no external requests of its own.
  assert.ok(!page.includes("<script"), "no script tags");
  assert.ok(!page.includes('rel="stylesheet"'), "no external stylesheet");
  assert.ok(page.includes('href="data:image/svg+xml,'), "data-uri favicon");
  assert.ok(page.includes('<meta name="viewport"'), "responsive viewport");
}

test("setup create page: manifest form contract is unchanged", () => {
  const page = renderSetupCreatePage({ state: STATE, manifest: MANIFEST });
  assert.ok(page.startsWith("<!doctype html>"));
  assert.ok(
    page.includes("<title>SolveLang Verification — create the app</title>")
  );
  assert.ok(
    page.includes(
      `<form action="https://github.com/settings/apps/new?state=${STATE}" method="post">`
    ),
    "form action carries the state token"
  );
  assert.ok(
    page.includes(`<input type="hidden" name="manifest" value='${MANIFEST}'>`),
    "hidden manifest field carries the manifest JSON"
  );
  assert.ok(page.includes(">Create GitHub App</button>"), "submit button label");
  assertDesignSystem(page);
});

test("setup create page: permission wording is verbatim", () => {
  const page = renderSetupCreatePage({ state: STATE, manifest: MANIFEST });
  assert.ok(
    page.includes(
      "One click, signed in as the app owner. The manifest requests only: checks write, contents read, pull requests write, issues write, metadata read — and the pull_request event."
    )
  );
  assert.ok(
    page.includes("<h1>Create the SolveLang Verification GitHub App</h1>")
  );
});

test("setup create page: manifest escaping matches the pre-redesign bytes", () => {
  const page = renderSetupCreatePage({
    state: STATE,
    manifest: "{\"note\":\"it's\"}",
  });
  assert.ok(page.includes("value='{\"note\":\"it&#39;s\"}'"));
  assert.ok(!page.includes("value='{\"note\":\"it's\"}'"));
});

test("setup app-created page: copy and install link", () => {
  const page = renderSetupAppCreatedPage({
    name: "SolveLang Verification",
    slug: "solvelang-verification",
  });
  assert.ok(
    page.includes("<title>SolveLang Verification — app created</title>")
  );
  assert.ok(page.includes("<h1>SolveLang Verification</h1>"));
  assert.ok(
    page.includes(
      "The GitHub App <strong>SolveLang Verification</strong> is created and this service holds its credentials."
    )
  );
  assert.ok(
    page.includes(
      '<a class="btn" href="https://github.com/apps/solvelang-verification/installations/new">Install it on a repository</a>'
    )
  );
  assertDesignSystem(page);
});

test("setup app-created page: falls back to slug when name is absent", () => {
  const page = renderSetupAppCreatedPage({ slug: "solvelang-verification" });
  assert.ok(page.includes("<strong>solvelang-verification</strong>"));
});

test("manifest callback success page: identity and install link", () => {
  const page = renderManifestCallbackSuccessPage({
    name: "SolveLang Verification",
    slug: "solvelang-verification",
    id: 123456,
  });
  assert.ok(
    page.includes("<title>SolveLang Verification — app created</title>")
  );
  assert.ok(page.includes("<h1>App created</h1>"));
  assert.ok(
    page.includes(
      "<strong>SolveLang Verification</strong> (solvelang-verification, id 123456) is created and its credentials are sealed on this service."
    )
  );
  assert.ok(
    page.includes(
      "https://github.com/apps/solvelang-verification/installations/new"
    )
  );
  assertDesignSystem(page);
});

test("manifest callback missing-code page", () => {
  const page = renderManifestCallbackMissingCodePage();
  assert.ok(page.includes("<h1>Missing manifest code</h1>"));
  assert.ok(page.includes('href="/setup"'), "links back to setup");
  assertDesignSystem(page);
});

test("manifest callback failure page: copy is verbatim", () => {
  const page = renderManifestCallbackFailurePage();
  assert.ok(page.includes("<h1>App creation exchange failed</h1>"));
  assert.ok(
    page.includes(
      "The manifest code could not be exchanged. It is valid for a few minutes only — restart from"
    )
  );
  assert.ok(page.includes('<a href="/setup">/setup</a>'));
  assertDesignSystem(page);
});
