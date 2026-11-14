import assert from "node:assert/strict";
import test from "node:test";
import {
  githubAuthorizeUrl,
  githubInstallStartUrl,
  githubSignInOutcome,
  parseGitHubSetupParams,
} from "./github-install";

test("GitHub flow URLs target the API routes", () => {
  assert.equal(githubAuthorizeUrl("https://api.solve-lang.com"), "https://api.solve-lang.com/github/auth/authorize");
  assert.equal(githubInstallStartUrl("https://api.solve-lang.com"), "https://api.solve-lang.com/github/install/start");
});

test("setup params parse only the exact install redirect shape", () => {
  assert.deepEqual(
    parseGitHubSetupParams("?installation_id=42&setup_action=install&state=nonce-1"),
    { installationId: 42, setupAction: "install", state: "nonce-1" },
  );
  assert.equal(parseGitHubSetupParams("?installation_id=42&setup_action=update&state=nonce-1"), null);
  assert.equal(parseGitHubSetupParams("?installation_id=42&setup_action=install"), null);
  assert.equal(parseGitHubSetupParams("?setup_action=install&state=nonce-1"), null);
  assert.equal(parseGitHubSetupParams("?installation_id=abc&setup_action=install&state=nonce-1"), null);
  assert.equal(parseGitHubSetupParams("?installation_id=-3&setup_action=install&state=nonce-1"), null);
  assert.equal(parseGitHubSetupParams(""), null);
});

test("sign-in outcome reads only the two documented values", () => {
  assert.equal(githubSignInOutcome("?github=connected"), "connected");
  assert.equal(githubSignInOutcome("?github=error"), "error");
  assert.equal(githubSignInOutcome("?github=anything-else"), null);
  assert.equal(githubSignInOutcome(""), null);
});
