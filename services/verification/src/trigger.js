// Re-review trigger — the `/solvelang verify` PR comment command.
//
// Pure parsing only; the webhook wiring lives in server.js. A comment
// triggers a fresh verification run on the PR's current head when:
//   - the webhook event is issue_comment with action "created"
//     (edits do not re-trigger — a command is an act, not a state);
//   - the issue is a pull request (issue.pull_request present);
//   - some line of the comment body, trimmed, is exactly the command
//     (case-insensitive) — a quoted or discussed command inside a
//     longer sentence does not fire it.
//
// GitHub delivers issue_comment events only when the app subscribes
// to them; the manifest (src/manifest.js) declares the subscription
// for future app creations. The live app created in Slice 1
// subscribes to pull_request only — enabling the issue_comment event
// on it is an app-settings step for the owner (README, "Slice 2").

export const VERIFY_COMMAND = "/solvelang verify";

export function isVerifyCommand(body) {
  if (typeof body !== "string") return false;
  return body
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase() === VERIFY_COMMAND);
}

export function parseIssueCommentTrigger(payload) {
  if (!payload || payload.action !== "created") return null;
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !issue.pull_request) return null;
  if (!comment || !isVerifyCommand(comment.body)) return null;
  const repository = payload.repository;
  if (!repository?.name || !repository?.owner?.login) return null;
  if (!Number.isSafeInteger(issue.number)) return null;
  return {
    owner: repository.owner.login,
    repo: repository.name,
    prNumber: issue.number,
    installationId: payload.installation?.id ?? null,
    commentId: comment.id ?? null,
  };
}
