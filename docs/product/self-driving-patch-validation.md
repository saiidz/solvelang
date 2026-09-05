# Self-Driving patch validation evidence v0

Status: **review-only evidence contract; validation execution disabled**.

`solvelang.self-driving.patch-validation.v0` binds the non-applied patch preview to the validation plan declared by its source Suggest proposal. It accepts only caller-supplied bounded evidence; it does not run tests, linters, builds, shell commands, browsers, providers, or external tools.

## Evidence rule

Every patch proposal must receive evidence for every validation step declared by its source Suggest proposal exactly once. Evidence contains only the declared validation kind/label, one of `passed`, `failed`, or `blocked`, an explicit UTC observation time, and an opaque bounded evidence locator.

Missing, extra, duplicate, undeclared, malformed, multiline, raw-looking, or credential-like evidence fails closed. Exact Suggest/Patch proposal identity is rechecked before evidence is accepted.

A proposal is `reviewReady` only when all declared validations passed and both the source Suggest plan and Patch Preview are complete. A partial upstream artifact may still carry passing evidence, but it can never become review-ready.

## Authority boundary

The contract records all of the following as unavailable:

- validation/test command execution;
- patch application;
- shell execution;
- GitHub or repository writes;
- provider/network/credential access;
- rollout/production/billing mutation;
- Solve Runner authority;
- external side effects.

This evidence artifact is a prerequisite for later PR authorization review. It is not PR creation authority and does not resolve a GitHub token, create a branch, write a commit, or open a pull request.
