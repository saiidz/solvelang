# SolveLang Verification — service

The self-serve verification loop: a GitHub App a repository owner
installs in minutes, which posts a graded Change Impact Receipt as a
**Check Run** (with inline annotations) plus a sticky PR comment on
every pull request, and writes every run to the SolveLang governance
audit log. Report-only by default; enforce mode is an in-repo
setting.

## The app and its permissions (published set)

The GitHub App **SolveLang Verification** is created by the App
Manifest flow from this service's `/setup` page, which locks the
permission set at creation — minimal on purpose, because expanding
permissions later forces every installation to re-consent:

| Permission | Level | Why |
| --- | --- | --- |
| Metadata | read | baseline |
| Contents | read | fetch the PR head tree (tarball) and read config/policy files |
| Pull requests | write | PR metadata and changed files for the receipt — and the receipt comment itself: GitHub gates an app token's PR conversation comments on this permission (issues: write alone is refused 403 on PRs; proven first-hand in the Nov 26, 2026 stranger proof). The service never merges, never approves, never writes code |
| Checks | write | create + complete the verification check run, with annotations |
| Issues | write | the sticky receipt comment on plain issues (PR conversations need pull requests: write — see above) |

Events: `pull_request` only. Not requested: contents write, actions,
administration, workflows — the service never writes code, never
merges, never touches settings.

## Per-repo configuration (in-repo, from day one)

`.github/solvelang-verification.json`, read at the PR's **base SHA**
(a PR cannot weaken its own gate):

```json
{
  "version": 1,
  "mode": "report-only",
  "requiredChecks": [],
  "ignorePaths": []
}
```

- `mode`: `report-only` (default; the check concludes `success` and
  states the evidence) or `enforce` (blocking evidence concludes the
  check **`failure`**, so branch protection can require it).
- `requiredChecks`: check-run names that must be present, completed,
  and successful on the head for the run to pass in enforce mode.
- `ignorePaths`: policy-glob paths excluded from the PR Gate's
  changed set (the receipt's file evidence stays complete; the
  excluded count is reported).

An invalid file falls back to defaults and says so in the check
summary. Blocking evidence = a PR Gate policy FAIL, a failed or
unusable gate route, failing head CI, or a required check missing /
not successful. Unverified findings never block alone.

Optionally, `pr-gate.policy.json` at the repo root drives the gate's
protected paths, blast-radius ceiling, and affected-validation rules
(the PR Gate's own policy format).

## Runtime shape

Plain Node ESM, zero runtime dependencies. On a signed
`pull_request` webhook (opened / reopened / synchronize) the service
answers 202 and runs asynchronously: open check run → read config at
base SHA → wait (bounded, default 180s) for the head's other checks
to settle → tarball-fetch the head tree → PR Gate CLI (report-only)
→ GitHub receipt collector with the gate result embedded → receipt
built by the site's own builder → verdict + annotations → complete
check run → sticky comment → audit POST to the governance API
(`POST /verification/audit`, admin-token header; every completed run
and every operational failure is recorded).

Credentials: the manifest callback seals the created app's
credentials to `VERIFICATION_APP_CREDENTIALS` (default
`/data/app.json`, mode 0600), loaded lazily per request — creating
the app needs no restart. Until the file exists, `/health` reports
`appConfigured: false` and webhooks answer 503.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `VERIFICATION_PORT` | `8080` | |
| `VERIFICATION_PUBLIC_BASE` | `https://verify.solve-lang.com` | webhook + manifest URLs derive from it |
| `VERIFICATION_APP_CREDENTIALS` | `/data/app.json` | sealed by the manifest callback |
| `VERIFICATION_REPO_ROOT` | three levels above `src/` | the checkout the compiled kit is read from |
| `VERIFICATION_WORK_ROOT` | `/tmp/verification-runs` | per-run trees, removed after each run |
| `VERIFICATION_MGOV_BASE` | the governance API base | audit route host |
| `VERIFICATION_MGOV_ADMIN_TOKEN` | — | required for audit writes; keep in a 0600 env file |
| `VERIFICATION_CHECKS_SETTLE_TIMEOUT_MS` | `180000` | CI settle wait bound |

## Deploy (host)

From a full checkout of the merged commit on the host:

```sh
cd services/verification && npm run build:kit && cd ../..
docker build -f services/verification/Dockerfile -t solvelang-verification-svc:<tag> .
docker run -d --name solvelang-verification-svc --restart unless-stopped \
  --env-file /root/verification-svc/env \
  -v /root/verification-svc/data:/data \
  <traefik labels for the service host> \
  solvelang-verification-svc:<tag>
curl -s https://verify.solve-lang.com/health
```

Then open `https://verify.solve-lang.com/setup` once (signed in to
GitHub as the app owner) to create the app, and install it from
`https://verify.solve-lang.com/install`.

## Tests

```sh
npm test   # node --test test/*.test.js — verdict, runner, auth pins
```
