# SolveLang Local CLI Contract for UpcomingSounds

Date: 2026-07-14
Status: draft local-only contract
Base commit: `f4f5cff9d0e7a84e67aa6447096e450860282e80`

## Purpose

This contract defines the local, non-production SolveLang CLI behavior that must be merged and independently verified before UpcomingSounds may consider executing a SolveLang workflow. It does not create an UpcomingSounds runtime integration.

## Structured workflow interface

The local CLI accepts an explicit JSON file and exposes its parsed value to the script as the read-only global `input`:

```bash
solvec run workflow.solve \
  --input fixture.json \
  --json \
  --safe \
  --dry-run \
  --no-network
```

In `--json` mode, values passed to `print(...)` are captured instead of being mixed into stdout. The CLI emits one deterministic JSON envelope containing a typed `outputs` array. The envelope contains no timestamp or random identifier and is labeled `NON-PRODUCTION ADVISORY ONLY`.

Malformed input, unsafe capabilities, policy-invalid imports, parser failures, and runtime failures exit nonzero. JSON mode returns a machine-readable error envelope without echoing input contents.

## Flag semantics

- `--input <file>` reads one explicit, regular JSON file with a bounded size. The parsed value is injected as read-only `input`.
- `--json` enables strict hardened execution and emits exactly one deterministic advisory JSON envelope.
- `--safe`, `--dry-run`, and `--no-network` each enable the same strict hardened capability policy. Successful non-JSON hardened runs emit `NON-PRODUCTION ADVISORY ONLY` before workflow output.
- `--dry-run` evaluates pure workflow logic after a static capability preflight.
- Hardened execution rejects every capability-enabling `--allow-*` flag. It denies HTTP, AI/agent use, runtime file reads and writes, environment reads, shell/process/plugin actions, mutation tools, and unknown function calls.
- Local entry-source reads, confined `.solve` import reads, and the one explicit JSON input read are admitted by the CLI source policy; they do not enable runtime file builtins.

## Source and import safety

For `--safe`, `--dry-run`, `--no-network`, or `--json` runs, execution and source-loading policies are built before the entry file or any import is read. The entry workflow establishes a canonical source root. Imports must be relative regular `.solve` files whose canonical paths remain below that root. Absolute imports, parent traversal, symlink escapes, and circular imports fail closed.

Imported workflow statements are included in the same static capability preflight. An imported `http_get`, `http_post`, `ask`, `read_file`, `write_file`, or `env` action cannot execute when its capability is denied.

## Dry-run guarantees

The CLI dry-run contract permits deterministic language evaluation over the explicit workflow source, confined imports, and explicit JSON input. It does not permit:

- network access or OpenAI-backed `ask`;
- runtime filesystem reads or writes;
- environment-variable reads;
- shell or process execution;
- plugins or mutation tools;
- hosted runtime behavior.

SolveLang currently has no shell, plugin, database, payment, email, queue, or Linear built-ins. Unknown functions remain rejected.

## Allowed UpcomingSounds use cases

- artist preview lead qualification;
- Search Console URL triage;
- Public Music readiness checklist drafting;
- Stripe E2E checklist routing using synthetic evidence only;
- weekly launch blocker report drafting;
- Linear-ready Markdown issue drafting.

## Forbidden uses

- production launch-gate decisions or activation;
- live Stripe calls, charges, refunds, subscriptions, payouts, or webhook replay;
- Public Music activation;
- emails, messages, or Linear mutations;
- production data, private user data, signed URLs, private media paths, payment identifiers, secrets, or auth tokens;
- production deployment, migration, or environment mutation;
- public claims, counters, or numeric social proof.

## Dependency boundary

UpcomingSounds must remain validator-only until the draft CLI contract PR from branch `codex/upcomingsounds-safe-cli-contract` is merged and the merged commit is reverified. A draft, local branch, or passing pre-merge test run is not sufficient authorization to execute SolveLang from UpcomingSounds.
