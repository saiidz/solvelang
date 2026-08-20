# Server Audit v0

Status: **built for review; not deployed by this branch**.

Server Audit is a local-first diagnostic product for understanding a Linux server before changing it. v0 intentionally separates **evidence collection** from **analysis** and contains no remediation executor.

## Safety boundary

The official collector:

- accepts no user-supplied command arguments;
- runs a fixed read-only evidence allowlist;
- does not use `sudo` or write to the target host;
- does not restart/reload services, edit configuration, install/remove packages, change permissions, modify firewall rules, rotate certificates, or create/delete backups;
- does not collect environment variables, private keys, credential files, database/customer contents, process command lines, or cron command bodies;
- emits only bounded inventory/posture metadata to stdout;
- marks `metadata.redactionsApplied=true` and documents intentional omissions.

The browser analyzer:

- reads a local JSON snapshot through the File API;
- sends no snapshot to a SolveLang API in v0;
- applies deterministic rules only;
- generates stable finding IDs and portable JSON/HTML evidence reports;
- does not execute remediation commands;
- treats missing evidence as a coverage limitation rather than proof of safety.

## Evidence contract

Snapshot schema: `schemas/server-audit-snapshot.schema.json`.

Collected categories include:

- host/OS/kernel/architecture;
- uptime/load/memory summary;
- filesystem capacity;
- listening TCP/UDP sockets with bounded process name only;
- bounded process inventory containing PID, parent PID, numeric uid, state, and executable `comm` name only;
- service state inventory;
- bounded, exact-name service/process/listener relationship evidence, preserving ambiguous or unresolved attribution rather than guessing ownership;
- installed package names/versions as inventory (not CVE conclusions);
- scheduled-job source names with command bodies omitted;
- web server activity and candidate web-root metadata;
- framework hints derived only from file existence;
- fixed existence-only checks for `.env`, `.git/config`, `.npmrc`, and Composer `auth.json` under candidate web roots; contents are never read;
- Let's Encrypt certificate expiry metadata where readable;
- backup artifact metadata from conventional backup paths;
- top-level log file size/mtime metadata;
- firewall, SSH login, MAC-policy, and automatic-update posture where readable.

## Deterministic findings

v0 checks include:

- critically/highly utilized filesystems;
- sensitive or unexpected listeners bound to all interfaces;
- root/password SSH posture;
- host firewall not reported active;
- automatic security update posture not confirmed;
- TLS certificates expired or approaching expiry;
- world/group-writable web roots;
- framework web roots owned by root as a low-severity review signal;
- fixed sensitive-file markers present under candidate web roots, without claiming that local presence proves HTTP reachability;
- explicit absence/staleness of collected backup evidence;
- very large log files;
- stale log-activity candidates based only on collected modification timestamps, without inferring rotation success or workload health;
- local web-server and conventional HTTP(S)-listener evidence gaps, without inferring endpoint reachability or scanning the network;
- failed/dead service evidence;
- contradictory process topology evidence such as conflicting duplicate PIDs, self-parenting, or cyclic parent relationships;
- collector redaction assurance/coverage gaps.

## What v0 does not claim

- Package versions are **not** matched against a vulnerability database in this version.
- Cloud security groups/NACLs/WAF/IAM are not inferred from host firewall evidence.
- Local presence of a sensitive-file marker under a candidate web root is **not** proof that the file is publicly served.
- Backup existence is not treated as restore proof.
- Database integrity/content is not inspected.
- Application secrets/customer contents are not inspected.
- A clean report is not a penetration test, compliance certification, or guarantee of security.
- Service/listener attribution does not infer process paths, supervisor aliases, case-folded names, or network reachability from a local socket record.

## Collector usage

Run from a clean checkout on the server:

```bash
node tools/server-audit/collect.mjs > server-audit-snapshot.json
```

Review the snapshot locally before transferring it. Then import it at `/server-audit/`.

For an SSH-managed host, an operator may choose to run that exact fixed collector through their existing access method, but v0 deliberately does not accept host credentials or implement an automated SSH client.

## Report integrity

Report IDs are deterministic over snapshot identity and finding IDs. The report stores sanitized evidence summaries and explicit limitations. It never embeds a private key, environment variable dump, customer content, or remediation command intended for automatic execution.

## Future phases

Future reviewed phases may add:

1. optional signed collector bundles;
2. external/cloud evidence adapters;
3. package advisory matching with timestamped source provenance;
4. backup restore-evidence ingestion;
5. separate owner-approved remediation plans that remain human-reviewed and never execute automatically by default.

Those capabilities are outside v0 and require their own safety review.
