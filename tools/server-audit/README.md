# Server Audit collector

`collect.mjs` emits a bounded, read-only Linux posture snapshot to stdout for import into SolveLang Server Audit.

```bash
node tools/server-audit/collect.mjs > server-audit-snapshot.json
```

Review the JSON before transferring it. The collector accepts no host, command, credential, or path arguments from the operator.

It intentionally does **not** collect environment variables, private keys, credential contents, database/customer contents, process command lines, or cron command bodies, and it performs no remediation or writes to the host.

For remote hosts, copy the reviewed repository/collector through your existing administrative process and run it there, or execute that exact fixed command through an already-approved SSH process. v0 does not implement SSH credential handling.
