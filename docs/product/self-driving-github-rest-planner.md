# Self-Driving GitHub REST request planner v0

Status: **pure request planning only; no Authorization header, credential resolution, or network transport**.

`solvelang.self-driving.github-rest-request.v0` freezes the GitHub.com REST surface that a later credential-bearing Self-Driving runtime may use. The planner exists so a live adapter cannot invent endpoints, methods, force-push behavior, merge operations, or unbounded responses while holding repository write permission.

The v0 boundary targets `https://api.github.com` only and pins:

- `Accept: application/vnd.github+json`;
- `X-GitHub-Api-Version: 2026-03-10`.

Authorization is deliberately absent from every planned request. Ephemeral auth must be added only by a separately reviewed transport boundary immediately before dispatch and must never be returned in result artifacts.

## Allowlisted read operations

Live preflight may plan only:

1. `GET /repos/{owner}/{repo}/branches/{base}` — exact base commit identity;
2. `GET /repos/{owner}/{repo}/rules/branches/{base}` — active rules applying to the protected base;
3. `GET /repos/{owner}/{repo}/git/ref/heads/{head}` — exact proposed-head existence check, where 404 is the only accepted absent state;
4. `GET /repos/{owner}/{repo}/git/commits/{baseRevision}` — immutable base commit/tree identity;
5. `GET /repos/{owner}/{repo}/git/trees/{treeSha}?recursive=1` — target blob SHA and mode evidence, with truncation required to fail closed in the later parser;
6. `GET /repos/{owner}/{repo}/git/blobs/{blobSha}` — exact immutable base content for deterministic patch materialization.

The later response parser must reject malformed identity, oversized bodies, redirects, unexpected status codes, truncated tree evidence, missing target paths, symlink/submodule targets, and any branch/rules weakening.

## Allowlisted write operations

The only planned write path is:

1. `POST /repos/{owner}/{repo}/git/refs` — create the approved `refs/heads/{head}` at the exact reviewed base revision;
2. `POST /repos/{owner}/{repo}/git/trees` — create one tree over the immutable base tree using only materialized target files and preserved `100644`/`100755` modes;
3. `POST /repos/{owner}/{repo}/git/commits` — create one commit whose sole parent is the reviewed base revision;
4. `PATCH /repos/{owner}/{repo}/git/refs/heads/{head}` — advance only the approved head ref with `force: false`;
5. `POST /repos/{owner}/{repo}/pulls` — open the approved head against the protected base.

There is no merge endpoint, no delete-ref endpoint, no protected-base ref update, no force push, no workflow dispatch, no issue/comment mutation, and no arbitrary generic REST escape hatch.

## File-mode preservation

Git tree entries require a mode. v0 accepts only existing regular/executable blob modes `100644` and `100755`, bound to the exact reviewed base blob SHA. Symlinks (`120000`), submodules (`160000`), trees, and unsupported modes fail closed rather than being rewritten as ordinary files.

## Bounds and permissions

Every request carries an explicit expected-status set, maximum response-body size, and required permission category. Read-only branch/Git-object operations use Contents read, active-rules inspection uses Metadata read, Git database writes use Contents write, and PR creation uses Pull Requests write.

The planner itself performs no network call and contains no credential material. Redirects, retries, force push, direct protected-base writes, and automatic merge are all explicitly forbidden in every planned request.

A later transport/response adapter must preserve these exact plans, add ephemeral auth without serializing it, enforce streaming/body limits before buffering, reject redirects and URL drift, parse only the expected response schema, and sanitize all failures.