# Production private Admin console publication

Status: **publication-ready preparation only; static Admin UI is not published by this document or CI**.

The browser bundle under `admin-console-static/` contains no privileged server secret. It is designed to be served from the private Admin origin and to reach the signed-session gateway through the same-origin `/admin-gateway` prefix.

## Current production prerequisite state

As of 2026-08-19, the private ingress prerequisite has been deployed and canaried:

- `admin.solve-lang.com` resolves through Cloudflare;
- Cloudflare Access intercepts unauthenticated `/` and `/admin-gateway/session` requests;
- after Cloudflare Access authentication, `/` remains intentionally unpublished under the ingress-only Worker config;
- after Cloudflare Access authentication, `/admin-gateway/session` reaches the Admin Gateway and returns the expected unauthenticated `401 {"authenticated":false}` response;
- the Admin static UI remains a separate production gate.

Do not treat the live private-ingress/DNS approval as approval to publish browser assets.

## Build artifact

Run:

```bash
node admin-console-static/build-release.mjs <output-directory>
```

The builder copies exactly `index.html`, `styles.css`, `config.js`, and `app.js` and writes `manifest.json` with the SHA-256 and byte length of every file plus a deterministic bundle digest. CI builds the same artifact for review. Building or downloading this artifact does **not** publish it.

The Cloudflare publication config points at the same reviewed source directory. `admin-console-static/.assetsignore` excludes `build-release.mjs`, and the Worker has an independent runtime allowlist that serves only `/`, `/index.html`, `/styles.css`, `/config.js`, and `/app.js`. Unknown paths never fall through to arbitrary assets.

## Separated Cloudflare deployment configs

Two Wrangler configs intentionally exist:

- `services/admin-console-edge/wrangler.jsonc` is the **ingress-only** config. It has no static-assets binding. Deploying it preserves the current `admin_static_not_published` behavior.
- `services/admin-console-edge/wrangler.publication.jsonc` is the **static-publication** config. It adds only the reviewed `ASSETS` binding while preserving the same Worker name, custom domain, Admin origin, and Admin Gateway upstream.

The publication config uses `assets.run_worker_first: true`, so the Worker enforces the route allowlist and security headers before any static asset is returned. `/admin-gateway` and `/admin-gateway/*` continue to take precedence and are never served from static assets.

Merging publication preparation does not publish the Admin UI. A live publication requires intentionally deploying `wrangler.publication.jsonc` under the separate approval below.

## Required production gates before publication

1. PR #168 rollout machinery is merged.
2. The reviewed Admin Gateway deploy-role IAM supplement is live-applied under its separate owner approval.
3. The protected Admin Gateway deployment succeeds and its unauthenticated `/session` verification returns the expected 401/no-store/CORS response.
4. A distinct private HTTPS Admin origin is provisioned and protected by an identity-aware/Zero-Trust access layer.
5. The private ingress routes `/admin-gateway/*` to the deployed gateway while stripping only the `/admin-gateway` prefix. The browser must never receive or inject the upstream API admin secret.
6. Cloudflare Access and the ingress-only Worker are live and verified for `admin.solve-lang.com`.
7. The exact static-publication PR head is green and reviewed.
8. The owner supplies a fresh exact production approval phrase:

```text
APPROVE ADMIN STATIC UI PRODUCTION PUBLICATION
```

Generic phrases such as `next`, `continue`, `proceed`, or approval of private ingress/DNS do not satisfy this gate.

## Static-origin contract

Serve the browser payload only on `https://admin.solve-lang.com`. The Worker must set these controls on every static response:

- `Content-Security-Policy: default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `Cache-Control: no-cache`

Never cache `/admin-gateway/*`; authenticated gateway responses require `Cache-Control: no-store`.

## Same-origin ingress contract

The checked-in public config resolves the gateway base to `${window.location.origin}/admin-gateway`. Therefore the ingress exposes the gateway under that prefix on the same private origin. This keeps the `__Host-` admin session cookie host-bound and avoids cross-origin credential handling.

The proxy/rewrite layer must:

- preserve HTTPS and normalize the upstream `Origin` to the reviewed Admin origin;
- forward request bodies and methods unchanged;
- forward `Set-Cookie` from the gateway unchanged;
- strip `/admin-gateway` exactly once before forwarding to the gateway base URL;
- remove Cloudflare Access identity material before forwarding to AWS while preserving the SolveLang Admin session cookie;
- disable caching for all gateway responses;
- reject access when the upstream target is absent rather than falling back to the public API/customer origin.

## Pre-publication dry run

From a trusted checkout pinned to the exact reviewed publication commit:

```bash
cd services/admin-console-edge
npm test
npx --yes wrangler@4.124.0 deploy \
  --config wrangler.publication.jsonc \
  --dry-run \
  --outdir /tmp/solvelang-admin-static-publication-dryrun
```

The dry run must show the same Worker name and `admin.solve-lang.com` custom domain plus the `ASSETS` binding. Stop if Wrangler reports an unexpected route, hostname, account, replacement, or deletion.

## Live publication

Only after every gate above passes and the exact approval phrase has been supplied:

```bash
cd services/admin-console-edge
npx --yes wrangler@4.124.0 deploy --config wrangler.publication.jsonc
```

This updates the existing `solvelang-admin-private-ingress` Worker; it must not create or broaden another hostname, Access application, or DNS scope.

## Post-publication canary

Verify in order:

1. an unauthenticated external browser is still intercepted by Cloudflare Access before the Admin app is served;
2. the authenticated operator receives the noindex SolveLang Admin page, with no third-party script or network dependency;
3. static responses carry the required security headers and `Cache-Control: no-cache`;
4. `GET /admin-gateway/session` returns unauthenticated 401 before Admin password login;
5. Admin password login creates the secure host-bound session and returns a CSRF token;
6. a read-only customer lookup succeeds through the gateway;
7. sign-out revokes the Admin session;
8. production billing remains disabled and no email, charge, customer mutation, or CRM mutation is performed by this canary.

Account access-state changes, CRM writes, and permanent termination are operational mutations and are not part of the publication canary.

## Static-publication rollback

If the Admin UI publication canary fails but Cloudflare Access and the Admin Gateway remain healthy, roll back only the static publication by redeploying the ingress-only config:

```bash
cd services/admin-console-edge
npx --yes wrangler@4.124.0 deploy --config wrangler.jsonc
```

Then verify that authenticated `/` again returns `404 admin_static_not_published` while authenticated `/admin-gateway/session` still returns the expected unauthenticated 401. Do not weaken or remove Cloudflare Access as a publication rollback.
