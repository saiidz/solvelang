// URL and redirect-parameter helpers for the SolveLang GitHub App flows.
// Kept pure (no window, no fetch) so the studio tests can pin them: the
// account page and the GitHub setup page both build on these.

export type GitHubSetupParams = {
  installationId: number;
  setupAction: string;
  state: string;
};

export function githubAuthorizeUrl(apiBase: string): string {
  return `${apiBase}/github/auth/authorize`;
}

export function githubInstallStartUrl(apiBase: string): string {
  return `${apiBase}/github/install/start`;
}

function paramsFrom(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

// GitHub redirects back to the app's Setup URL after an install with
// ?installation_id=<id>&setup_action=install&state=<nonce>. Only that
// exact shape is a link attempt: the API consumes the state single-use
// and bound to the signed-in account, so anything malformed is ignored
// here instead of being posted.
export function parseGitHubSetupParams(search: string): GitHubSetupParams | null {
  const params = paramsFrom(search);
  const setupAction = params.get("setup_action");
  const rawId = params.get("installation_id");
  const state = params.get("state");
  if (setupAction !== "install" || !rawId || !state) return null;
  if (!/^\d+$/.test(rawId)) return null;
  const installationId = Number(rawId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return null;
  return { installationId, setupAction, state };
}

// The API's GitHub sign-in callback lands back on the account page with
// ?github=connected or ?github=error; every other value means "no GitHub
// outcome to report".
export function githubSignInOutcome(search: string): "connected" | "error" | null {
  const value = paramsFrom(search).get("github");
  return value === "connected" || value === "error" ? value : null;
}
