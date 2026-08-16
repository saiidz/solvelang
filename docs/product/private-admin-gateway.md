# Private Admin Gateway

Status: **built for review; not deployed by this branch**.

## Why this replaces the original hosting plan

The existing `admin-console/` prototype depends on server-rendered Next.js routes to keep `API_ACCESS_ADMIN_SECRET` off the browser. The production site is a static export, so putting those routes into the public site would either fail at build/runtime or tempt secret exposure.

This build separates the concerns:

- `admin-console-static/` is static HTML/CSS/JS and contains no privileged secret;
- `services/admin-console-gateway/` is a Node.js 22 Lambda/API Gateway boundary that holds the existing upstream API admin secret server-side;
- the browser receives only a signed, expiring, HttpOnly `__Host-` admin session cookie plus a CSRF token;
- the gateway exposes only a fixed allowlist of CRM/account operations and injects the upstream admin secret only on server-to-server calls.

## Authentication and session properties

- independent admin password stored only as a scrypt verifier;
- independent HMAC session secret, minimum 32 characters;
- eight-hour signed session lifetime;
- `HttpOnly; Secure; SameSite=Strict; Path=/` cookie;
- exact configured Origin required;
- CSRF token required for every mutation;
- bounded source login attempts in the application layer; production ingress should add WAF/rate limiting as defense in depth;
- generic invalid-credential response;
- no secret values in successful or failed browser responses.

## Irreversible account termination

The low-level internal account-access endpoint supports state transitions after the server admin secret is proven. The gateway adds an independent irreversible-action guard: `state=terminated` is not proxied unless the browser supplies exactly:

```text
TERMINATE <canonical acct_... ID>
```

The confirmation is stripped before the upstream call. This makes termination protection server-enforced rather than UI-only.

## Hosting contract

A future deployment can serve `admin-console-static/` from a private/static origin and route `/admin-gateway/*` to the gateway API on the same host. The SAM stack defaults `AdminConsoleGatewayEnabled=false` and requires explicit secrets/parameters to create runtime resources.

Recommended production ingress adds an external access-control layer before the application login (for example corporate SSO/Zero Trust), but that is a separate deployment decision.

## Explicit non-actions

This branch does not:

- deploy the gateway or static console;
- create DNS/CloudFront/Amplify resources;
- create or rotate any secret;
- mutate customer or CRM data;
- enable billing/Stripe;
- send email;
- perform charges.
