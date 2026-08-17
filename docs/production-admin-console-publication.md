# Production private Admin console publication

Status: **publication-ready artifact preparation only; not published by this document or CI**.

The browser bundle under `admin-console-static/` contains no privileged server secret. It is designed to be served from the private Admin origin and to reach the signed-session gateway through the same-origin `/admin-gateway` prefix.

## Build artifact

Run:

```bash
node admin-console-static/build-release.mjs <output-directory>
```

The builder copies exactly `index.html`, `styles.css`, `config.js`, and `app.js` and writes `manifest.json` with the SHA-256 and byte length of every file plus a deterministic bundle digest. CI builds the same artifact for review. Building or downloading this artifact does **not** publish it.

## Required production gates before publication

1. PR #168 rollout machinery is merged.
2. The reviewed Admin Gateway deploy-role IAM supplement is live-applied under its separate owner approval.
3. The protected Admin Gateway deployment succeeds and its unauthenticated `/session` verification returns the expected 401/no-store/CORS response.
4. A distinct private HTTPS Admin origin is provisioned and protected by an identity-aware/Zero-Trust access layer. Do not use the public customer origin as a shortcut.
5. The private ingress routes `/admin-gateway/*` to the deployed gateway while stripping only the `/admin-gateway` prefix. The browser must never receive or inject the upstream API admin secret.
6. Static publication and ingress/DNS changes receive their own explicit production approval.

## Static-origin contract

Serve the release artifact only on the private Admin origin. Preserve these controls at the hosting layer even though the HTML also carries defensive metadata:

- `Content-Security-Policy: default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Robots-Tag: noindex, nofollow, noarchive`

Because the browser filenames are intentionally stable rather than content-hashed, prefer revalidation or `no-cache` for the static files during the initial rollout. Never cache `/admin-gateway/*`; authenticated gateway responses already require `Cache-Control: no-store`.

## Same-origin ingress contract

The checked-in public config resolves the gateway base to `${window.location.origin}/admin-gateway`. Therefore the ingress must expose the gateway under that prefix on the same private origin. This keeps the `__Host-` admin session cookie host-bound and avoids cross-origin credential handling.

The proxy/rewrite layer must:

- preserve HTTPS and the browser `Origin` header;
- forward request bodies and methods unchanged;
- forward `Set-Cookie` from the gateway unchanged;
- strip `/admin-gateway` exactly once before forwarding to the gateway base URL;
- disable caching for all gateway responses;
- reject access when the upstream target is absent rather than falling back to the public API/customer origin.

## Post-publication canary

After a separately approved publication, verify in order:

1. the private access layer denies an unauthenticated external browser before the Admin app is served;
2. the authenticated operator receives the expected noindex Admin page and no third-party script/network dependency;
3. `GET /admin-gateway/session` returns unauthenticated 401 before Admin password login;
4. Admin password login creates the secure host-bound session and returns a CSRF token;
5. a read-only customer lookup succeeds through the gateway;
6. sign-out revokes the Admin session;
7. production billing remains disabled and no email, charge, customer mutation, or CRM mutation is performed by this canary.

Account access-state changes, CRM writes, and permanent termination are operational mutations and are not part of the publication canary.
