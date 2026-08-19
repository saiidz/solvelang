# Production private Admin ingress

Status: **production ingress implementation prepared; static Admin UI publication remains separate**.

This stage places an identity-aware Cloudflare edge in front of the already-deployed Admin Gateway without publishing the browser Admin application. The Worker custom domain is exactly `admin.solve-lang.com`; `workers.dev` is disabled; only `/admin-gateway` and `/admin-gateway/*` proxy upstream. Every other path returns `404 admin_static_not_published` until a later static-publication approval.

## Fixed production contract

- Admin origin: `https://admin.solve-lang.com`
- Worker: `solvelang-admin-private-ingress`
- Gateway upstream: `https://ru2uokfkge.execute-api.us-east-2.amazonaws.com/admin-gateway`
- Browser ingress prefix: `/admin-gateway`
- Worker custom domain: `admin.solve-lang.com`
- `workers.dev`: disabled
- Static assets: absent in this stage

The Worker strips Cloudflare Access identity headers/cookies before forwarding to AWS, preserves the SolveLang Admin session cookie, rejects foreign browser origins, normalizes same-origin requests to the exact reviewed Admin origin, and forces `Cache-Control: no-store` on gateway responses.

## Required order

1. Confirm `solve-lang.com` is an active Cloudflare zone in the owner account.
2. Confirm there is no existing DNS record or Worker Custom Domain for `admin.solve-lang.com`. Stop on any conflict; do not overwrite an existing hostname.
3. Create a Cloudflare Access **Self-hosted and private** application for the public hostname `admin.solve-lang.com` before attaching the Worker custom domain.
4. Add an Allow policy scoped only to the intended owner/operator identity. Leave all other users denied. Do not create a broad email-domain, Everyone, Bypass, or Service Auth policy for browser access.
5. Verify the Access application is active and matches the exact hostname.
6. Deploy `services/admin-console-edge/wrangler.jsonc`. Cloudflare Workers Custom Domains create the DNS record and managed certificate for the hostname.
7. Verify the hostname is protected by Access before treating the ingress rollout as complete.

Do not enable Cloudflare's account-wide "Require Access protection" setting as part of this rollout; that setting can block unrelated public hostnames if they do not already have matching Access applications.

## Deployment

Use a narrowly scoped Cloudflare API token held only in the operator shell. Do not paste the token into chat, source files, command history, screenshots, or GitHub logs.

From the repository root:

```bash
cd services/admin-console-edge
npm test
npx --yes wrangler@4 deploy --config wrangler.jsonc
```

Wrangler must report the custom domain as `admin.solve-lang.com`. A deployment that adds a `workers.dev` route, a wildcard domain, any static asset binding, or a different upstream must be rejected.

## Post-deploy canary

Verify in this order:

1. An unauthenticated browser request to `https://admin.solve-lang.com/` is intercepted by Cloudflare Access and does not reach the Worker response.
2. After authenticating through Access, `GET /` returns `404` with JSON code `admin_static_not_published`.
3. After authenticating through Access, `GET /admin-gateway/session` reaches the existing Admin Gateway and returns `401 {"authenticated":false}` before Admin password login.
4. The gateway response remains `Cache-Control: no-store`.
5. No Admin static application is served in this stage.
6. Production subscription billing remains disabled; no Stripe action, email, customer mutation, CRM write, account state change, or charge is part of this canary.

## Rollback

If Access is not protecting the hostname, remove the Worker Custom Domain immediately rather than weakening Access. Do not publish the static Admin UI as a workaround. Do not change the public customer origin or production API stack during this rollback.

Static Admin publication remains a separately approved production action after this ingress is verified.
