import { createHash } from "node:crypto";

// Internal provider adapter. Not reachable from the production worker until its
// tenant-policy/cursor integration has been reviewed. No network at import time.
export const IMAP_SUPPORT_LIMITS = Object.freeze({ wireBytes: 262144, textBytes: 20000, uidWindow: 50, deadlineMs: 15000 });
const UINT32_MAX = 4294967295;
const fail = (code) => Object.assign(new Error(code), { code });
const digest = (value) => createHash("sha256").update(value).digest("hex");

function address(value) {
  // A mailbox address, not a display-name, group, or recipient list.
  if (typeof value !== "string" || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value)) throw fail("mailbox_address_invalid");
  return value.toLowerCase();
}
function uid(value) {
  if (!(typeof value === "bigint" || typeof value === "number" || (typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value)))) throw fail("imap_uid_invalid");
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > UINT32_MAX) throw fail("imap_uid_invalid");
  return result;
}
function bindingOf(input, hosts) {
  if (!input || typeof input !== "object" || !/^acct_[A-Za-z0-9_-]{1,100}$/.test(input.accountId || "")) throw fail("mailbox_binding_invalid");
  const mailbox = address(input.mailbox);
  if (typeof input.host !== "string" || !hosts.has(input.host) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(input.host)) throw fail("mailbox_host_not_approved");
  const folder = input.folder ?? "INBOX";
  if (typeof folder !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _./-]{0,127}$/.test(folder)) throw fail("mailbox_folder_invalid");
  const prefix = `:secret:solvelang/support-automation/${input.accountId}/`;
  if (typeof input.credentialSecretArn !== "string" || input.credentialSecretArn.length > 512 || !/^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$/.test(input.credentialSecretArn) || !input.credentialSecretArn.includes(prefix)) throw fail("mailbox_secret_scope_invalid");
  const sourceId = digest(JSON.stringify([input.accountId, mailbox, input.host, folder]));
  return Object.freeze({ accountId: input.accountId, mailbox, host: input.host, folder, credentialSecretArn: input.credentialSecretArn, sourceId });
}
function baselineOf(binding, baseline) {
  if (!baseline || baseline.sourceId !== binding.sourceId) throw fail("imap_cutover_required");
  return { sourceId: binding.sourceId, uidValidity: uid(baseline.uidValidity), nextUid: uid(baseline.nextUid) };
}
function messageUid(binding, baseline, id) {
  const match = typeof id === "string" && /^imap:([a-f0-9]{64}):([1-9][0-9]{0,9}):([1-9][0-9]{0,9})$/.exec(id);
  if (!match || match[1] !== binding.sourceId || uid(match[2]) !== baseline.uidValidity || uid(match[3]) < baseline.nextUid) throw fail("imap_message_identity_invalid");
  return uid(match[3]);
}
function identity(binding, validity, value) { return `imap:${binding.sourceId}:${uid(validity)}:${uid(value)}`; }
function ensureEpoch(client, baseline) {
  if (!client.mailbox || uid(client.mailbox.uidValidity) !== baseline.uidValidity) throw fail("imap_uidvalidity_changed");
}
function singleHeader(parsed, name) {
  const value = parsed.headers?.get(name);
  if (Array.isArray(value)) throw fail("mail_header_ambiguous");
  return typeof value === "string" ? value : "";
}
async function defaultImap(options) { const { ImapFlow } = await import("imapflow"); return new ImapFlow(options); }
async function defaultSmtp(options) { const { default: nodemailer } = await import("nodemailer"); return nodemailer.createTransport(options); }
async function defaultParse(source, options) { const { simpleParser } = await import("mailparser"); return simpleParser(source, options); }

/** The host allowlist comes from reviewed deployment configuration, never the mailbox user. */
export function createImapSmtpSupportProvider({ credentialResolver, allowedHosts = [], createImapClient = defaultImap, createSmtpTransport = defaultSmtp, parseMessage = defaultParse, allowSend = false, allowedReplyRecipients = [], deadlineMs = IMAP_SUPPORT_LIMITS.deadlineMs }) {
  if (typeof credentialResolver !== "function" || !Array.isArray(allowedHosts) || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > IMAP_SUPPORT_LIMITS.deadlineMs) throw fail("mailbox_dependencies_invalid");
  const hosts = new Set(allowedHosts);
  const recipients = new Set(allowedReplyRecipients.map(address));

  async function bounded(code, work) {
    let expired = false;
    let close = () => {};
    let timer;
    const guard = {
      check() { if (expired) throw fail(code); },
      onClose(fn) { close = fn; if (expired) { try { close(); } catch { /* sanitized failure below */ } } },
    };
    try {
      return await Promise.race([
        work(guard),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; try { close(); } catch { /* no provider error/credential logs */ } reject(fail(code)); }, deadlineMs); }),
      ]);
    } finally { expired = true; clearTimeout(timer); try { close(); } catch { /* preserve original result */ } }
  }
  async function credentials(binding, guard) {
    const secret = await credentialResolver(binding.credentialSecretArn);
    guard.check();
    if (!secret || address(secret.username) !== binding.mailbox || typeof secret.password !== "string" || secret.password.length < 16 || secret.password.length > 1024 || /[\r\n\0]/.test(secret.password)) throw fail("mailbox_credential_invalid");
    // Do not spread secret fields into connection options: no authzid, host, CA,
    // proxy, custom port or TLS-validation override may come from a secret.
    return { user: binding.mailbox, pass: secret.password };
  }
  async function withMailbox(input, readOnly, operation) {
    const binding = bindingOf(input, hosts);
    try {
      return await bounded("imap_operation_timeout", async (guard) => {
        const auth = await credentials(binding, guard);
        const client = await createImapClient({ host: binding.host, port: 993, secure: true, auth, servername: binding.host,
          tls: { servername: binding.host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
          logger: false, emitLogs: false, logRaw: false, disableCompression: true, disableAutoIdle: true,
          connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000 });
        guard.onClose(() => client.close());
        client.on?.("error", () => {}); // operation failures are caught and sanitized, never logged raw
        guard.check();
        await client.connect(); guard.check();
        if (!client.secureConnection || typeof client.authenticated !== "string" || address(client.authenticated) !== binding.mailbox) throw fail("imap_authenticated_identity_mismatch");
        const lock = await client.getMailboxLock(binding.folder, { readOnly }); guard.check();
        try { return await operation(client, binding, guard); } finally { lock.release(); }
      });
    } catch (error) {
      if (typeof error?.code === "string" && /^(?:imap_|mailbox_|mail_)/.test(error.code)) throw fail(error.code);
      throw fail("imap_operation_failed");
    }
  }

  return {
    async captureCutover(input) {
      // Authenticate and EXAMINE only; no historical messages are fetched.
      return withMailbox(input, true, async (client, binding) => ({ sourceId: binding.sourceId, uidValidity: uid(client.mailbox.uidValidity), nextUid: uid(client.mailbox.uidNext) }));
    },
    async scanNew(input, cutover, cursor = cutover?.nextUid) {
      const binding = bindingOf(input, hosts);
      const baseline = baselineOf(binding, cutover);
      const first = uid(cursor);
      if (first < baseline.nextUid) throw fail("imap_cursor_before_cutover");
      return withMailbox(input, true, async (client, _, guard) => {
        ensureEpoch(client, baseline);
        const last = Math.min(uid(client.mailbox.uidNext) - 1, first + IMAP_SUPPORT_LIMITS.uidWindow - 1);
        if (last < first) return { messages: [], nextCursor: first }; // never issue an inverted UID range
        const messages = [];
        const ids = new Set();
        for await (const item of client.fetch(`${first}:${last}`, { uid: true }, { uid: true })) {
          guard.check(); const value = uid(item.uid);
          if (value < first || value > last || ids.has(value) || messages.length >= IMAP_SUPPORT_LIMITS.uidWindow) throw fail("imap_scan_response_invalid");
          ids.add(value); messages.push({ id: identity(binding, baseline.uidValidity, value) });
        }
        ensureEpoch(client, baseline);
        messages.sort((a, b) => messageUid(binding, baseline, a.id) - messageUid(binding, baseline, b.id));
        // The caller MUST durably enqueue/process these identities before CAS-
        // advancing its cursor. This adapter does not persist progress or set Seen.
        return { messages, nextCursor: last + 1 };
      });
    },
    async readMessage(input, cutover, id) {
      const binding = bindingOf(input, hosts);
      const baseline = baselineOf(binding, cutover);
      const value = messageUid(binding, baseline, id);
      return withMailbox(input, true, async (client, _, guard) => {
        ensureEpoch(client, baseline);
        const metadata = await client.fetchOne(value, { uid: true, size: true, internalDate: true }, { uid: true }); guard.check();
        if (!metadata || metadata.uid !== value) throw fail("imap_message_missing");
        if (!Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > IMAP_SUPPORT_LIMITS.wireBytes) throw fail("imap_message_too_large");
        const { content } = await client.download(value, undefined, { uid: true, maxBytes: IMAP_SUPPORT_LIMITS.wireBytes + 1, chunkSize: 8192 }); guard.check();
        const chunks = []; let total = 0;
        for await (const chunk of content) {
          guard.check(); total += chunk.length;
          if (total > IMAP_SUPPORT_LIMITS.wireBytes) { content.destroy?.(); throw fail("imap_message_too_large"); }
          chunks.push(Buffer.from(chunk));
        }
        if (total !== metadata.size) throw fail("imap_message_incomplete");
        ensureEpoch(client, baseline);
        const parsed = await parseMessage(Buffer.concat(chunks), { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true, maxHtmlLengthToParse: IMAP_SUPPORT_LIMITS.textBytes }); guard.check();
        const from = parsed.from?.value;
        if (!Array.isArray(from) || from.length !== 1) throw fail("mail_sender_ambiguous");
        const sender = address(from[0].address);
        const recipients = [...(parsed.to?.value ?? []), ...(parsed.cc?.value ?? [])];
        if (!recipients.some(entry => { try { return address(entry.address) === binding.mailbox; } catch { return false; } })) throw fail("mail_recipient_mismatch");
        const text = parsed.text;
        if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > IMAP_SUPPORT_LIMITS.textBytes || parsed.attachments?.length) throw fail("mail_content_requires_review");
        const auto = singleHeader(parsed, "auto-submitted");
        if (sender === binding.mailbox || (auto && auto.toLowerCase() !== "no") || /^(?:bulk|junk|list)$/i.test(singleHeader(parsed, "precedence")) || parsed.headers?.has("list-id") || singleHeader(parsed, "return-path") === "<>") throw fail("mail_auto_reply_prohibited");
        if (parsed.replyTo?.value?.some(entry => address(entry.address) !== sender)) throw fail("mail_reply_identity_ambiguous");
        const subject = parsed.subject ?? "Support request";
        if (typeof subject !== "string" || subject.length > 180 || /[\r\n\0]/.test(subject)) throw fail("mail_subject_invalid");
        const rfcMessageId = parsed.messageId;
        if (typeof rfcMessageId !== "string" || rfcMessageId.length > 250 || !/^<[^<>\s]+@[^<>\s]+>$/.test(rfcMessageId)) throw fail("mail_message_id_invalid");
        return { id, from: sender, to: binding.mailbox, subject, text, rfcMessageId, receivedAt: metadata.internalDate?.toISOString() };
      });
    },
    async sendReply(input, { id, cutover, to, subject, text, inReplyTo }) {
      const binding = bindingOf(input, hosts);
      messageUid(binding, baselineOf(binding, cutover), id);
      const recipient = address(to);
      if (!allowSend || !recipients.has(recipient) || recipient === binding.mailbox) throw fail("smtp_reply_not_authorized");
      if (typeof subject !== "string" || subject.length > 240 || /[\r\n\0]/.test(subject) || typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > IMAP_SUPPORT_LIMITS.textBytes || typeof inReplyTo !== "string" || inReplyTo.length > 250 || !/^<[^<>\s]+@[^<>\s]+>$/.test(inReplyTo)) throw fail("smtp_message_invalid");
      const messageId = `<solvelang-${digest(`${binding.sourceId}:${id}`)}@${binding.mailbox.split("@")[1]}>`;
      try {
        return await bounded("smtp_outcome_unknown", async (guard) => {
          const auth = await credentials(binding, guard);
          const smtp = await createSmtpTransport({ host: binding.host, port: 587, secure: false, requireTLS: true, ignoreTLS: false, opportunisticTLS: false,
            auth, tls: { servername: binding.host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
            connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 5000,
            logger: false, debug: false, pool: false, disableFileAccess: true, disableUrlAccess: true });
          guard.onClose(() => smtp.close()); guard.check();
          const result = await smtp.sendMail({ from: binding.mailbox, to: recipient, envelope: { from: binding.mailbox, to: [recipient] },
            subject, text, inReplyTo, references: inReplyTo, messageId,
            headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" }, disableFileAccess: true, disableUrlAccess: true }); guard.check();
          if (!Array.isArray(result.accepted) || result.accepted.length !== 1 || address(result.accepted[0]) !== recipient || result.rejected?.length || !/^250(?:[ -]|$)/.test(result.response || "") || result.messageId !== messageId) throw fail("smtp_outcome_unknown");
          return { id: messageId, acceptedForDelivery: true, delivered: false };
        });
      } catch { throw fail("smtp_outcome_unknown"); } // no resend: even a timeout may follow acceptance
    },
  };
}
