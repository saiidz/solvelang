# Solve Self-Driving GitHub installation-token mint boundary

This boundary implements the secret-provider mechanics immediately behind the merged installation runtime gate, while keeping private-key loading and RSA signing injected.

It does **not** activate production Self-Driving writes by itself.

## GitHub contract

The request planner is fixed to:

- `POST https://api.github.com/app/installations/{installation_id}/access_tokens`;
- `Accept: application/vnd.github+json`;
- `X-GitHub-Api-Version: 2026-03-10`;
- exactly one repository name in `repositories`;
- permissions only:
  - `contents: write`;
  - `pull_requests: write`.

The no-secret plan contains no `Authorization` header, JWT, private key, token, generic endpoint, redirect permission, or retry authority.

GitHub repository metadata read remains runtime-normalized as the required metadata capability; the token mint request does not request unrelated permissions.

## GitHub App JWT contract

The injected signer receives exact non-secret signing claims:

- algorithm `RS256`;
- exact configured app issuer;
- `iat` set 60 seconds before the mint clock for clock-skew tolerance;
- `exp` set 9 minutes after the mint clock, remaining inside GitHub's 10-minute maximum future expiration.

Core accepts only a three-segment JWT whose decoded header is exactly `typ=JWT`, `alg=RS256`, and whose decoded payload contains exactly `iat`, `exp`, and `iss` matching the requested claims.

Core does not and cannot verify the RSA signature without the GitHub App public/private-key trust material; GitHub verifies the signature at the token endpoint. The future isolated signer must sign these exact claims with the approved app private key.

## Token response proof

A successful token response must prove:

- HTTP `201` from the exact mint URL;
- bounded JSON response size and JSON content type;
- `repository_selection: selected`;
- exactly one repository whose `full_name` matches the approved repository;
- permissions exactly `contents: write` and `pull_requests: write`, with optional `metadata: read` only;
- a bounded non-empty token and explicit UTC expiration.

Any extra repository or permission causes fail-closed rejection before the credential callback.

The returned runtime credential normalizes permissions to metadata-read / contents-write / pull-requests-write and uses the runtime credential request time as conservative issuance evidence. The merged runtime gate independently enforces its short-lived lifetime and activation-window requirements.

## One token per execution

The provider instance binds to one activation/plan/repository/installation identity. It mints once on first use and caches that raw token only in the provider instance's in-memory closure.

Later adapter operations reuse the same cached token. A near-expiry cached token causes terminal failure rather than minting a second token inside the same one-shot execution. This preserves the merged runtime gate's same-token-session invariant and avoids unnecessary token issuance.

The provider instance is intended to be created per one-shot execution and discarded afterward. Raw tokens are not serialized, logged, added to returned artifacts, or exposed through request plans.

## Signer and transport containment

The injected JWT signer may enter its secret callback exactly once and must return exactly that callback result. Re-entry or result substitution fails closed.

The mint transport is one fixed POST with redirects disabled and no retry. Raw signer/private-key errors and raw transport/JWT errors are collapsed into a bounded provider failure before they can reach the Self-Driving executor result.

## Current token format

The provider intentionally does not assume installation tokens are exactly 40 characters. GitHub's 2026 stateless installation-token rollout can produce a longer format; core validates only bounded opaque token safety rather than legacy length/prefix assumptions.

## Still not implemented or activated

This slice still does not provide:

- private-key retrieval from a production secret store;
- local RSA/RS256 signing implementation;
- a real production app issuer/client ID configuration;
- cached-token revocation through `DELETE /installation/token`;
- durable activation/kill-switch storage;
- automatic token cleanup after process crash;
- owner-authorized live Self-Driving PR canary;
- merge/auto-merge, workflow dispatch, force push, direct protected-base write;
- production application/billing/provider mutation;
- Solve Runner authority.

The next isolated runtime slice should bind a secret-store-backed private-key signer and token revocation/cleanup lifecycle to the existing activation gate, then qualify a no-write/fixture integration before any owner-authorized live PR canary.
