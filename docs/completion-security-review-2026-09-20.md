# Completion-boundary verification — 2026-09-20

Scope: the Studio persistence changes in #939, production maintenance in #940
and its follow-up, and native CLI qualification/Windows identity in #941.
This is a focused review of changed boundaries, not a new audit of every line
in SolveLang or proof of unexecuted production/provider acceptance.

| Requirement / risk | Observable evidence | Result / limit |
| --- | --- | --- |
| Account isolation and session changes | API tests reject missing sessions, invalid origin/CSRF and changed account identity before writes; storage keys bind account ID | Repository pass; two real account sessions still required |
| Concurrent device writes | Conditional revision tests admit one writer and reject stale snapshots with 409 | Repository pass; DynamoDB production roundtrip pending |
| Invalid nested workflow/history | API ships the browser's generated canonical schemas, with source-fingerprint freshness checks and invalid document/version/trace tests | Repository pass |
| Restore data loss | Tests preserve existing local projects, remap restored version IDs and roll back partial local-storage writes | Repository pass |
| Upload consent and privacy | UI requires connect plus explicit save confirmation; autosave pauses after errors/conflicts; frontend stays gated | Source/build pass; enabled browser and cross-device acceptance pending |
| Production configuration preservation | All parameters use previous values; resource and complete processed-template checks reject unrelated changes | First preview stopped safely; revised plan and actual deployment passed, preserving all live parameters |
| Operational template drift | Follow-up projects only code/API properties onto the deployed template; regression preserves table/IAM settings | Pass in plan 35530924473 and deployment 35531150309; no table/IAM updates |
| Native source identity | Windows uses volume serial + 128-bit file ID and retains original open handle; replacement and hard-link tests run on Windows | Pass on Windows at `ed0dbcc82467fb690d2d8dd4420a964001b44846` |
| Artifact provenance | Actual native host/source checks, clean checkout, package/extract byte comparison, installed version/help, checksum and Actions identity | Both platforms passed run 35530427540; #941 merged at `9a98883cdef2619e6d5b54e57d2c7d2279ec76ae` |

## Failure classification

- Initial Windows hardened-entry failure: implementation gap. Stable Windows
  identity support was added; the hardened tests were retained.
- Later Windows filesystem tests: fixture defect. Raw Windows backslashes were
  embedded unescaped in workflow strings. JSON string serialization fixes the
  fixture; filesystem-boundary assertions remain unchanged.
- Windows fixture portability: preserve LF for the byte-exact help fixture and
  join conformance paths natively so canonical Windows verbatim paths remain
  valid. Assertions and conformance expectations are unchanged.
- Initial production preview: deployment-template mismatch. It proposed changing
  the CRM table, so the guard stopped execution. The follow-up preserves deployed
  resource settings rather than expanding permission to mutate the table.
- Mac runner-label review finding: contradicted by the actual successful ARM64
  job and current GitHub runner documentation; the label was retained.

## Remaining evidence

The API backend is deployed and rejects unauthenticated Studio access. The
account-saving UI must remain disabled until real account/device acceptance
passes. Payment/refund, support reply/task actions,
PostHog credentials/canary, provider benchmarking, marketplace installation and
public directory listing are separate outstanding acceptance items. No unit
suite, native package, merge or public health flag closes those items.
