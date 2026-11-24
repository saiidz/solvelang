# Team Context Index (remote MCP tier)

Status: additive feature of the hosted (remote) MCP server. The local
stdio server is untouched, and the single-user remote surface is
unchanged: the master bearer token and `MCP_REMOTE_TEST_TOKEN` behave
exactly as before, and existing tokens list the same 10 read-only tools.

## What it is

A **team** is a record on the remote server: a name, an owner account
email, a member list, pending invites, and one **shared context index**
— the context-index document for the team's connected repo/workspace
scope. The team owner invites members **by account email**. Each member
who accepts receives **their own team token** and shares the team's
index. There are no price fields and no checkout wiring: a team is an
access record, not a billing surface.

## Tokens

- Team tokens carry the `slteam_` prefix; invite tokens carry `slinv_`.
- A plaintext token is returned exactly once (team creation returns the
  owner token, invite creation returns the invite token, invite
  acceptance returns the member token). The store keeps only the
  SHA-256 hash and a display prefix; lookups hash the supplied token and
  compare with `timingSafeEqual`.
- A team token authenticates the exact same 10-tool read-only `/mcp`
  surface as a single-user token — no more, no fewer.

## Routes

All team routes are rate-limited **before** authentication, on the same
fixed-window limiter as `/mcp`. When no team store is configured, every
team route fails closed with `503 {"error":"team_store_unavailable"}`
and `/mcp` is unaffected.

| Route | Auth | Effect |
| --- | --- | --- |
| `POST /teams` | single-user bearer (master or test token) | Create a team `{name, ownerEmail, contextIndex?}` → `201 {team, owner, ownerToken}` |
| `POST /teams/:id/invites` | team owner token, or single-user bearer | Invite `{email}` → `201 {invite, inviteToken}` (token shown once, as it would be emailed) |
| `POST /teams/accept` | the invite token itself | `{inviteToken, email}` → `200 {team, member, memberToken}`; the email must match the invite |
| `GET /teams/:id/members` | any active member of the team, or single-user bearer | Member list (emails, roles, statuses, token prefixes — never token values or hashes) |
| `POST /teams/:id/revoke` | team owner token, or single-user bearer | `{email}` → member marked `revoked` |
| `DELETE /teams/:id/members/:email` | team owner token, or single-user bearer | Same revocation as the POST route |
| `GET /teams/:id/context-index` | active member of THIS team only | The team's shared context index |
| `PUT /teams/:id/context-index` | team owner token only | Replace the shared context index (`{contextIndex}`, a JSON object, ≤ 1 MiB) |

## Access rules (pinned by tests)

- A member token reaches **only its own team's** shared index. Another
  team's token gets `403`; a single-user token also gets `403` on team
  index reads — the single-user scope and team scopes never mix.
- **Revocation is immediate**: a revoked member's token returns `401` on
  `/mcp` and `403` on team routes at the next request. The owner token
  and the single-user tokens are separate records and are unaffected.
  The team owner cannot be revoked.
- An invite can be accepted once, only by the invited account email.

## Configuration

Teams are off unless a store is configured (fail-closed):

- `SOLVELANG_REMOTE_TEAM_STORE_FILE=/data/teams.json` — durable JSON
  file store (emails, roles, token hashes, shared indexes). The path
  must be writable by the container, e.g. a mounted volume; writes are
  atomic (temp file + rename, mode `0600`).
- `SOLVELANG_REMOTE_TEAMS=memory` — in-memory store for tests/dev only;
  records die with the process.
