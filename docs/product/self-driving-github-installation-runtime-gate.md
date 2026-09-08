# Solve Self-Driving GitHub installation runtime gate

This boundary sits between the merged concrete GitHub PR-write adapter and any future secret-bearing GitHub App installation-token provider.

It is **disabled by default** and does not itself load a GitHub App private key, mint a JWT, call the installation-token endpoint, read a secret store, cache a raw token, or activate production repository writing.

## Activation artifact

A runtime activation is SHA-256 bound to the exact reviewed PR-write execution plan, including its approval/claim binding, repository, GitHub App installation reference, and exact required permissions.

The installation reference must use:

`github-app/installation:<positive installation id>`

Activation has explicit UTC `notBefore` and `expiresAt` values and is bounded to at most 15 minutes. It cannot begin before the PR-write claim.

Creating or merging this artifact is not a live activation. A separately injected runtime gate must allow the exact activation ID at credential-use time.

## Least privilege

The runtime requires credential evidence normalized to exactly:

- one repository: the exact reviewed `owner/name` repository;
- metadata: read;
- contents: write (which covers the adapter's required content reads and writes);
- pull requests: write.

No additional repository scope or permission keys are accepted.

This matches GitHub's installation-token scoping model: callers must explicitly request repository and permission narrowing rather than accepting the installation's default broad access.

## Short-lived credential session

GitHub installation tokens are short-lived. The core requires:

- issuance inside the activation window;
- a valid UTC expiration;
- at least 30 seconds remaining at each use;
- a bounded lifetime no greater than 61 minutes;
- the same non-secret credential session ID, issuance time, expiration time, and internal SHA-256 token binding for the entire one-shot adapter execution.

The SHA-256 token binding is internal runtime state only. The raw token and its binding are not returned in public artifacts or results.

The injected credential provider is expected to reuse/cache one valid installation token for the execution rather than minting a new token for every REST operation.

## Live gate / kill switch

Before every credential-provider call, core invokes the injected runtime gate with only non-secret identity:

- exact activation ID;
- exact plan ID;
- exact repository;
- exact installation ID/ref;
- exact requested permission;
- current UTC check time.

A blocked, malformed, throwing, stale, expired, or backwards-clock gate makes the credential runtime terminally fail. The credential provider and network transport are not called when the gate blocks first.

This per-use check is the hook for an owner-controlled enable/disable record and emergency kill switch in the eventual isolated runtime.

## Credential-provider contract

The injected provider receives a non-secret request containing the exact one-repository and permission scope. It may call its secret callback exactly once and must return exactly that callback's result.

Core rejects:

- callback re-entry;
- a provider that never completes the callback;
- a provider that swallows/replaces the callback result;
- changed token/session identity during one execution;
- broader repository scope;
- broader/different permissions;
- installation drift;
- future-issued, nearly expired, overlong, or pre-activation credentials.

Provider/runtime errors are collapsed by the existing bounded transport into credential-broker failure; raw provider errors and raw credentials do not escape through the PR-write adapter.

## Plan binding

The runtime independently recomputes the execution plan's SHA-256 identity. The returned adapter also revalidates the candidate plan on `verifyLivePreflight` and rejects a different cryptographically valid plan before runtime-gate, credential-provider, or transport access.

## What remains external

This PR does not implement or authorize:

- GitHub App private-key storage/access;
- JWT creation/signing;
- `POST /app/installations/{installation_id}/access_tokens`;
- token cache/revocation implementation;
- a production secret store;
- the owner-controlled activation store/kill switch;
- a live Self-Driving PR canary;
- merge/auto-merge, workflow dispatch, force push, direct protected-base writes;
- production application/billing/provider mutation;
- Solve Runner authority.

A future isolated secret-provider slice must prove exact single-repository token creation, exact permissions, safe private-key handling, token cache/revocation behavior, and owner-controlled activation before a first live PR canary is permitted.
