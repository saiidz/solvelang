# Self-Driving GitHub REST response evidence boundary

Status: implementation candidate for exact-head qualification.

This layer binds the bounded GitHub REST responses from the request planner and transport into the exact evidence contracts consumed by the merged one-shot PR write executor. It is a pure parser/validator: it performs no network, credential, repository, provider, production, billing, or Solve Runner action.

## Live preflight evidence

The adapter recreates the exact request plans before accepting each response and requires matching operation, URL, allowed status, response-byte bound, and no-leak/no-redirect/no-retry transport policy.

For the protected base branch it requires:

- the exact reviewed base branch name and 40-hex revision;
- GitHub reporting the base branch as protected;
- an active `pull_request` rule with approvals not weaker than the reviewed execution plan;
- all reviewed required status-check contexts still present;
- an active `non_fast_forward` rule so force pushes remain prohibited;
- the planned head ref to return the explicitly allowed 404 absent state.

Path-specific `required_reviewers` rules are rejected in v0 because the executor live-preflight contract cannot faithfully represent their file-pattern semantics. Failing closed is safer than silently flattening them into a weaker repository-wide approval count.

## Exact base tree and blobs

The adapter requires the exact base commit to identify one base tree, then requires the recursive tree response to:

- match that exact tree SHA;
- report `truncated: false`;
- contain each planned path exactly once;
- identify every planned path as a regular Git blob;
- preserve only regular/executable file modes (`100644` or `100755`);
- match every reviewed base blob SHA exactly.

Each unique planned base blob must have one bounded Git blob response. GitHub base64 content is decoded with exact byte-size verification and fatal UTF-8 decoding. Empty blobs are valid when GitHub reports size zero and empty base64 content.

The resulting evidence contains:

- canonical `solvelang.self-driving.pr-write-live-preflight.v0` evidence;
- the exact base tree SHA;
- exact path/blob/mode evidence for tree construction;
- exact UTF-8 base-file bytes for deterministic patch materialization.

The response body remains internal execution data and is not safe telemetry.

## Write-response binding

The pure write-response parsers fail closed unless:

- a created head ref is the exact approved branch at the exact approved base revision;
- the create-tree request is recomputed from the approved commit request, verified base tree, verified file modes, and deterministic materialization rather than accepted from a caller;
- a created commit points to the exact created tree and has exactly one parent equal to the approved base revision;
- the non-force head-ref update points the approved head branch to that exact commit;
- an opened pull request is open, non-draft, in the exact repository, targets the approved base branch, uses the approved head branch, and carries the exact created head revision.

The executor receives an opaque pull-request reference such as `#858`, never a URL.

## Authority that is still absent

This layer has no GitHub App installation-token resolver, network client, generic REST call, automatic merge, workflow dispatch, delete-ref, force-push, direct protected-base write, provider access, production mutation, billing mutation, deployment authority, or Solve Runner authority.

The next layer should compose the qualified request planner, bounded transport, this response adapter, and deterministic patch materializer into the existing injected `SelfDrivingPrWriteAdapter`. Concrete installation credential resolution and production/runtime activation remain separately governed after that composition qualifies.
