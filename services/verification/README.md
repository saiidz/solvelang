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

Events: `pull_request`; apps created from the current manifest also
subscribe to `issue_comment` (the `/solvelang verify` command — see
"Slice 2" below). Not requested: contents write, actions,
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
| `VERIFICATION_BACKTEST_DIR` | `/data/backtests` | persisted backtest jobs + the 24h per-repo report cache (on the data volume) |

## Slice 2 — backtest, re-review trigger, free tier

**Backtest** (`POST /backtest`, `GET /backtest/<id>`): replays the
grading over a **public** repository's most recent merged PRs
(default 10, max 10) — the same collector, receipt builder, and PR
Gate run a live check uses, with the repo's own verification config
read at each PR's base SHA. Unauthenticated GitHub reads throughout
(public repos only; trees come from codeload, outside the REST
budget). Output per PR: the graded finding counts
(verified / failed / unverified) and a classification — **catch**,
**false-block candidate**, **evidence incomplete** — under the
definitions published on the methodology page and carried verbatim
in every report. No check run is created and no audit record is
written for a replay. Completed reports are cached per repo for
24h; job starts are rate-limited per IP (3/hour); if GitHub
rate-limits a job mid-run, the remaining PRs are reported as
ungraded with the reason rather than failing the job.

**Re-review trigger**: a PR comment whose line is exactly
`/solvelang verify` starts a fresh verification run on the PR's
current head; the new check run and the updated sticky receipt
comment supersede the previous evidence. This needs the
`issue_comment` event on the app. Apps created from the current
manifest subscribe to it automatically. **The live app (created in
Slice 1) subscribes to `pull_request` only — enabling the trigger
on it is an owner step**: GitHub → Settings → Developer settings →
GitHub Apps → SolveLang Verification → Permissions & events →
Subscribe to events → check **Issue comments** → Save. (Event
subscriptions cannot be changed through the API.) Until then, real
comment events are not delivered; the service-side handler is live
and answers correctly signed deliveries.

**Free tier**: the check is free for public repositories and needs
no card and no trial signup — the service contains no billing code
at all. Install the app and it runs (report-only by default). There
is no public price yet; pricing is the owner's decision, informed
by the measured per-run cost.

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
