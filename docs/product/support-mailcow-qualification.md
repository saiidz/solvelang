# Mailcow support integration — active implementation, not launch approval

The owner's established setup remains unchanged: web/configuration at `mail.upcomingsounds.com`, SolveLang mailbox `hello@solve-lang.com`, and owner-tested implicit IMAP TLS on `mx1.upcomingsounds.com:993` plus SMTP STARTTLS on `mx1.upcomingsounds.com:587`. Historical inbound receipt and the existing outbound relay are recorded in issue #896. Those facts are not permission to access credentials, read current mail, reply, change the shared mail host or operate on another project.

## Implemented adapter

`services/api-access/src/support-automation-imap-smtp.js` uses ImapFlow, MailParser and Nodemailer via lazy imports. It implements an authenticated EXAMINE-only cutover snapshot; bounded UID scanning independent of the Seen flag; bounded read-only message download and MIME parsing; and explicitly gated, exact-recipient SMTP replies. It has no production caller yet. Imports never perform network activity. Host allowlists default empty and sending defaults false.

Inputs bind tenant account ID, mailbox, folder, approved host and tenant-scoped secret reference. Credentials have username/password fields; secrets cannot override endpoints, ports, TLS validation, proxy configuration or authorization identity. This is an internal draft contract, not an instruction for the owner to provision a secret yet.

The persisted first-run baseline must contain sourceId, UIDVALIDITY and UIDNEXT, captured immediately before the deliberately approved activation. Messages below that UID are excluded. UIDVALIDITY changes fail closed; they must not reset the baseline and sweep old messages. `scanNew` returns stable IDs and a proposed next cursor. The consumer MUST persist/complete the batch before conditional cursor advancement. A deterministic SMTP Message-ID does not replace durable action idempotency; unknown sends must not be retried blindly.

Reads do not set Seen. Attachments, HTML-only/oversize content, ambiguous addresses, mailing lists, auto-replies and missing reply identifiers are rejected for review rather than silently truncated or sent onward. These are bounded transport rules, not proof of sender authenticity or a complete production triage/security policy. In-flight SMTP timeout is an unknown outcome, not proof that delivery was cancelled. SMTP 250 acceptance is not recipient delivery evidence.

## Qualification still required on the same implementation branch

- Versioned provider selection and tenant-bound API/config/status controls; keep existing Gmail configuration compatible.
- Durable cutover/cursor storage and atomic advancement with concurrency/recovery tests, preserving action claims and account suspension/pause/revoke checks.
- Reviewed deployment endpoint configuration and separately gated reads/sends. No new mailbox/server/DNS/relay changes.
- Actual loopback TLS IMAP/SMTP protocol tests using the pinned libraries: certificate failure, required STARTTLS, partial bodies, UIDVALIDITY reset, timeouts/unknown acceptance and no late extra actions.
- Full exact-head API/site/Rust/WASM CI and review. Neither mocked tests nor a green partial PR close #896.
- Only after implementation qualification: owner-scoped credential provisioning and a new-message test with a controlled reply destination. Do not process the historical August test automatically.

## Reference contracts

- https://imapflow.com/docs/api/imapflow-client/
- https://nodemailer.com/extras/mailparser
- https://nodemailer.com/smtp

No live login, message access/send, task creation, deployment, secret/IAM update or release action is part of this patch.
