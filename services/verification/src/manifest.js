// The App Manifest for SolveLang Verification — the permission set
// is locked at app creation, so this object IS the published set.
//
// pull_requests is WRITE, not read: the Nov 26, 2026 stranger proof
// established first-hand (fresh installation token, API probes) that
// GitHub refuses an app token's comment on a pull request with 403
// "Resource not accessible by integration" when the app holds only
// issues: write + pull_requests: read — the same token comments on
// plain issues with 201. PR conversation comments are gated on the
// pull_requests permission for app tokens. The service still never
// writes code, never merges, never reviews-approves: pull_requests
// write is used for the receipt comment only, and every other use
// stays read-shaped in the client (src/github.js).

export function buildManifest(publicBase) {
  return {
    name: "SolveLang Verification",
    url: "https://www.solve-lang.com/change-impact-receipt/",
    hook_attributes: {
      url: `${publicBase}/webhooks/github`,
      active: true,
    },
    redirect_url: `${publicBase}/app-manifest-callback`,
    description:
      "Independent verification for pull requests: graded change-impact receipts (verified / failed / unverified), Solve Graph blast-radius and policy evidence, posted as a check run with inline annotations and a receipt comment. Report-only by default; enforce mode is an in-repo setting.",
    public: true,
    default_permissions: {
      checks: "write",
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
    },
    default_events: ["pull_request"],
  };
}
