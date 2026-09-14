import { createHash } from "node:crypto";

// Internal provider adapter. No network is performed at import time. Every live
// transport call is bounded and requires a reviewed endpoint plus a scoped secret.
export const IMAP_SUPPORT_LIMITS = Object.freeze({ wireBytes: 262144, textBytes: 20000, uidWindow: 50, cutoverMetadataWindow: 512, deadlineMs: 15000 });
const UINT32_MAX = 4294967295;
const fail = (code) => Object.assign(new Error(code), { code });
const digest = (value) => createHash("sha256").update(value).digest("hex");

function address(value) {
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
function ensureEpoch(client, baseline) { if (!client.mailbox || uid(client.mailbox.uidValidity) !== baseline.uidValidity) throw fail("imap_uidvalidity_changed"); }
function singleHeader(parsed, name) { const value = parsed.headers?.get(name); if (Array.isArray(value)) throw fail("mail_header_ambiguous"); return typeof value === "string" ? value : ""; }
function explicitAuthenticatedIdentity(client, mailbox) {
  // ImapFlow 2.x deliberately overwrites `authenticated` with boolean true after
  // successful password auth. Require evidence that LOGIN/AUTHENTICATE actually ran
  // before accepting that boolean so a PREAUTH greeting cannot satisfy this check.
  if (typeof client.authenticated === "string") return address(client.authenticated) === mailbox;
  if (client.authenticated !== true || !(client.authCapabilities instanceof Map)) return false;
  return ["LOGIN", "AUTH=PLAIN", "AUTH=LOGIN"].some((method) => client.authCapabilities.get(method) === true);
}
async function defaultImap(options) { const { ImapFlow } = await import("imapflow"); return new ImapFlow(options); }
async function defaultSmtp(options) { const { default: nodemailer } = await import("nodemailer"); return nodemailer.createTransport(options); }
async function defaultParse(source, options) { const { simpleParser } = await import("mailparser"); return simpleParser(source, options); }

/** The host allowlist comes from reviewed deployment configuration, never the mailbox user. */
export function createImapSmtpSupportProvider({ credentialResolver, allowedHosts = [], createImapClient = defaultImap, createSmtpTransport = defaultSmtp, parseMessage = defaultParse, allowSend = false, allowedReplyRecipients = [], deadlineMs = IMAP_SUPPORT_LIMITS.deadlineMs }) {
  if (typeof credentialResolver !== "function" || !Array.isArray(allowedHosts) || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > IMAP_SUPPORT_LIMITS.deadlineMs) throw fail("mailbox_dependencies_invalid");
  const hosts = new Set(allowedHosts), recipients = new Set(allowedReplyRecipients.map(address));

  async function bounded(code, work) {
    let expired = false, close = () => {}, timer;
    const guard = { check() { if (expired) throw fail(code); }, onClose(fn) { close = fn; if (expired) { try { close(); } catch {} } } };
    try { return await Promise.race([work(guard), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; try { close(); } catch {} reject(fail(code)); }, deadlineMs); })]); }
    finally { expired = true; clearTimeout(timer); try { close(); } catch {} }
  }
  async function credentials(binding, guard) {
    const secret = await credentialResolver(binding.credentialSecretArn); guard.check();
    if (!secret || address(secret.username) !== binding.mailbox || typeof secret.password !== "string" || secret.password.length < 16 || secret.password.length > 1024 || /[\r\n\0]/.test(secret.password)) throw fail("mailbox_credential_invalid");
    return { user: binding.mailbox, pass: secret.password };
  }
  async function withMailbox(input, readOnly, operation) {
    const binding = bindingOf(input, hosts);
    try {
      return await bounded("imap_operation_timeout", async (guard) => {
        const auth = await credentials(binding, guard);
        const client = await createImapClient({ host: binding.host, port: 993, secure: true, auth, servername: binding.host,
          tls: { servername: binding.host, rejectUnauthorized: true, minVersion: "TLSv1.2" }, logger: false, emitLogs: false, logRaw: false,
          disableCompression: true, disableAutoIdle: true, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000 });
        guard.onClose(() => client.close()); client.on?.("error", () => {}); guard.check(); await client.connect(); guard.check();
        if (!client.secureConnection || !explicitAuthenticatedIdentity(client, binding.mailbox)) throw fail("imap_authenticated_identity_mismatch");
        const lock = await client.getMailboxLock(binding.folder, { readOnly }); guard.check();
        try { return await operation(client, binding, guard); } finally { lock.release(); }
      });
    } catch (error) {
      if (typeof error?.code === "string" && /^(?:imap_|mailbox_|mail_)/.test(error.code)) throw fail(error.code);
      throw fail("imap_operation_failed");
    }
  }

  return {
    async captureCutover(input, initializationStartedAt) {
      return withMailbox(input, true, async (client, binding, guard) => {
        const uidValidity = uid(client.mailbox.uidValidity), snapshotNext = uid(client.mailbox.uidNext);
        if (initializationStartedAt === undefined) return { sourceId: binding.sourceId, uidValidity, nextUid: snapshotNext };
        const threshold = Date.parse(initializationStartedAt);
        if (!Number.isFinite(threshold)) throw fail("imap_cutover_time_invalid");
        const exists = Number(client.mailbox.exists);
        if (!Number.isSafeInteger(exists) || exists < 0) throw fail("imap_mailbox_state_invalid");
        if (exists === 0) return { sourceId: binding.sourceId, uidValidity, nextUid: snapshotNext };

        // The INITIALIZING state's persisted updatedAt is the durable cutover start.
        // Read only bounded tail metadata up to the mailbox snapshot that existed at
        // command start. A retry therefore cannot move the cutover forward and skip
        // mail that arrived after the owner requested activation.
        const firstSequence = Math.max(1, exists - IMAP_SUPPORT_LIMITS.cutoverMetadataWindow + 1);
        const recent = [];
        for await (const item of client.fetch(`${firstSequence}:${exists}`, { uid: true, internalDate: true })) {
          guard.check();
          if (recent.length >= IMAP_SUPPORT_LIMITS.cutoverMetadataWindow) throw fail("imap_cutover_window_exceeded");
          const value = uid(item.uid), received = item.internalDate instanceof Date ? item.internalDate.getTime() : NaN;
          if (!Number.isFinite(received)) throw fail("imap_cutover_metadata_invalid");
          recent.push({ uid: value, received });
        }
        if (uid(client.mailbox.uidValidity) !== uidValidity) throw fail("imap_uidvalidity_changed");
        recent.sort((a, b) => a.uid - b.uid);
        const postStart = recent.filter((item) => item.received >= threshold && item.uid < snapshotNext);
        if (postStart.length && firstSequence > 1 && recent[0]?.received >= threshold) throw fail("imap_cutover_window_exceeded");
        const nextUid = postStart.length ? Math.min(snapshotNext, postStart[0].uid) : snapshotNext;
        return { sourceId: binding.sourceId, uidValidity, nextUid };
      });
    },
    async scanNew(input, cutover, cursor = cutover?.nextUid) {
      const binding = bindingOf(input, hosts), baseline = baselineOf(binding, cutover), first = uid(cursor);
      if (first < baseline.nextUid) throw fail("imap_cursor_before_cutover");
      return withMailbox(input, true, async (client, _, guard) => {
        ensureEpoch(client, baseline);
        const last = Math.min(uid(client.mailbox.uidNext) - 1, first + IMAP_SUPPORT_LIMITS.uidWindow - 1);
        if (last < first) return { messages: [], nextCursor: first };
        const messages = [], ids = new Set();
        for await (const item of client.fetch(`${first}:${last}`, { uid: true }, { uid: true })) {
          guard.check(); const value = uid(item.uid);
          if (value < first || value > last || ids.has(value) || messages.length >= IMAP_SUPPORT_LIMITS.uidWindow) throw fail("imap_scan_response_invalid");
          ids.add(value); messages.push({ id: identity(binding, baseline.uidValidity, value) });
        }
        ensureEpoch(client, baseline); messages.sort((a, b) => messageUid(binding, baseline, a.id) - messageUid(binding, baseline, b.id));
        return { messages, nextCursor: last + 1 };
      });
    },
    async readMessage(input, cutover, id) {
      const binding = bindingOf(input, hosts), baseline = baselineOf(binding, cutover), value = messageUid(binding, baseline, id);
      return withMailbox(input, true, async (client, _, guard) => {
        ensureEpoch(client, baseline);
        const metadata = await client.fetchOne(value, { uid: true, size: true, internalDate: true }, { uid: true }); guard.check();
        if (!metadata || metadata.uid !== value) throw fail("imap_message_missing");
        if (!Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > IMAP_SUPPORT_LIMITS.wireBytes) throw fail("imap_message_too_large");
        const { content } = await client.download(value, undefined, { uid: true, maxBytes: IMAP_SUPPORT_LIMITS.wireBytes + 1, chunkSize: 8192 }); guard.check();
        const chunks = []; let total = 0;
        for await (const chunk of content) { guard.check(); total += chunk.length; if (total > IMAP_SUPPORT_LIMITS.wireBytes) { content.destroy?.(); throw fail("imap_message_too_large"); } chunks.push(Buffer.from(chunk)); }
        if (total !== metadata.size) throw fail("imap_message_incomplete"); ensureEpoch(client, baseline);
        const parsed = await parseMessage(Buffer.concat(chunks), { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true, maxHtmlLengthToParse: IMAP_SUPPORT_LIMITS.textBytes }); guard.check();
        const from = parsed.from?.value; if (!Array.isArray(from) || from.length !== 1) throw fail("mail_sender_ambiguous");
        const sender = address(from[0].address), messageRecipients = [...(parsed.to?.value ?? []), ...(parsed.cc?.value ?? [])];
        if (!messageRecipients.some(entry => { try { return address(entry.address) === binding.mailbox; } catch { return false; } })) throw fail("mail_recipient_mismatch");
        const text = parsed.text; if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > IMAP_SUPPORT_LIMITS.textBytes || parsed.attachments?.length) throw fail("mail_content_requires_review");
        const auto = singleHeader(parsed, "auto-submitted");
        if (sender === binding.mailbox || (auto && auto.toLowerCase() !== "no") || /^(?:bulk|junk|list)$/i.test(singleHeader(parsed, "precedence")) || parsed.headers?.has("list-id") || singleHeader(parsed, "return-path") === "<>") throw fail("mail_auto_reply_prohibited");
        if (parsed.replyTo?.value?.some(entry => address(entry.address) !== sender)) throw fail("mail_reply_identity_ambiguous");
        const subject = parsed.subject ?? "Support request"; if (typeof subject !== "string" || subject.length > 180 || /[\r\n\0]/.test(subject)) throw fail("mail_subject_invalid");
        const rfcMessageId = parsed.messageId; if (typeof rfcMessageId !== "string" || rfcMessageId.length > 250 || !/^<[^<>\s]+@[^<>\s]+>$/.test(rfcMessageId)) throw fail("mail_message_id_invalid");
        return { id, from: sender, to: binding.mailbox, subject, text, rfcMessageId, receivedAt: metadata.internalDate?.toISOString() };
      });
    },
    async sendReply(input, { id, cutover, to, subject, text, inReplyTo }) {
      const binding = bindingOf(input, hosts); messageUid(binding, baselineOf(binding, cutover), id); const recipient = address(to);
      if (!allowSend || !recipients.has(recipient) || recipient === binding.mailbox) throw fail("smtp_reply_not_authorized");
      if (typeof subject !== "string" || subject.length > 240 || /[\r\n\0]/.test(subject) || typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > IMAP_SUPPORT_LIMITS.textBytes || typeof inReplyTo !== "string" || inReplyTo.length > 250 || !/^<[^<>\s]+@[^<>\s]+>$/.test(inReplyTo)) throw fail("smtp_message_invalid");
      const messageId = `<solvelang-${digest(`${binding.sourceId}:${id}`)}@${binding.mailbox.split("@")[1]}>`;
      try {
        return await bounded("smtp_outcome_unknown", async (guard) => {
          const auth = await credentials(binding, guard);
          const smtp = await createSmtpTransport({ host: binding.host, port: 587, secure: false, requireTLS: true, ignoreTLS: false, opportunisticTLS: false, auth,
            tls: { servername: binding.host, rejectUnauthorized: true, minVersion: "TLSv1.2" }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 5000,
            logger: false, debug: false, pool: false, disableFileAccess: true, disableUrlAccess: true });
          guard.onClose(() => smtp.close()); guard.check();
          const result = await smtp.sendMail({ from: binding.mailbox, to: recipient, envelope: { from: binding.mailbox, to: [recipient] }, subject, text, inReplyTo, references: inReplyTo, messageId,
            headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" }, disableFileAccess: true, disableUrlAccess: true }); guard.check();
          if (!Array.isArray(result.accepted) || result.accepted.length !== 1 || address(result.accepted[0]) !== recipient || result.rejected?.length || !/^250(?:[ -]|$)/.test(result.response || "") || result.messageId !== messageId) throw fail("smtp_outcome_unknown");
          return { id: messageId, acceptedForDelivery: true, delivered: false };
        });
      } catch { throw fail("smtp_outcome_unknown"); }
    },
  };
}
