import { createHash, randomUUID } from "node:crypto";
import { ApiAccessError } from "./service.js";

const ALLOWED_ACTIONS = new Set(["create_linear_issue", "send_reply"]);
const SECRET_ARN = /^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:\d{12}:secret:solvelang\/support-automation\/[A-Za-z0-9/_+=.@-]+$/;
const MAX_MESSAGE_BYTES = 20_000;
const DEFAULT_POLICY_VERSION = "support-v1";
const EVENT_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_EVENT_STATES = new Set(["PROCESSED", "REVIEW_REQUIRED", "OUTCOME_UNKNOWN", "STOPPED"]);

function cleanText(value, label, maximum = 160) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_support_automation_request", `${label} is invalid.`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_support_automation_request", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanEmail(value, label = "Inbox email") {
  const email = cleanText(value, label, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiAccessError(400, "invalid_support_automation_request", `${label} is invalid.`);
  return email;
}

function cleanSecretArn(value, label, accountId) {
  const arn = cleanText(value, label, 512);
  const tenantPath = `:secret:solvelang/support-automation/${accountId}/`;
  if (!SECRET_ARN.test(arn) || !arn.includes(tenantPath)) {
    throw new ApiAccessError(400, "invalid_support_automation_secret_ref", `${label} must reference the authenticated account's scoped support-automation secret path.`);
  }
  return arn;
}

function cleanAllowedActions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new ApiAccessError(400, "invalid_support_automation_policy", "At least one permitted action is required.");
  }
  const actions = [...new Set(value.map((action) => cleanText(action, "Allowed action", 64)))];
  for (const action of actions) {
    if (!ALLOWED_ACTIONS.has(action)) throw new ApiAccessError(400, "invalid_support_automation_policy", "The support automation policy contains an unsupported action.");
  }
  return actions.sort();
}

function assertSession(session) {
  if (!session || typeof session.accountId !== "string" || !session.accountId) {
    throw new ApiAccessError(401, "support_automation_not_authorized", "Customer authentication is required.");
  }
  return session.accountId;
}

function normalizeConfiguration(accountId, input, timestamp, existing) {
  if (!input || typeof input !== "object") throw new ApiAccessError(400, "invalid_support_automation_request", "Support automation configuration is invalid.");
  if (input.provider !== "gmail") throw new ApiAccessError(400, "unsupported_support_provider", "Only the Gmail provider is supported by this vertical slice.");
  if (input.taskProvider !== "linear") throw new ApiAccessError(400, "unsupported_task_provider", "Only the Linear task provider is supported by this vertical slice.");
  return {
    accountId,
    recordType: "CONFIG",
    provider: "gmail",
    inboxEmail: cleanEmail(input.inboxEmail),
    gmailCredentialSecretArn: cleanSecretArn(input.gmailCredentialSecretArn, "Gmail credential secret reference", accountId),
    taskProvider: "linear",
    linearCredentialSecretArn: cleanSecretArn(input.linearCredentialSecretArn, "Linear credential secret reference", accountId),
    linearTeamId: cleanText(input.linearTeamId, "Linear team ID", 128),
    policyVersion: cleanText(input.policyVersion ?? DEFAULT_POLICY_VERSION, "Policy version", 80),
    allowedActions: cleanAllowedActions(input.allowedActions ?? ["create_linear_issue", "send_reply"]),
    automationState: "PAUSED",
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: new Date(timestamp).toISOString(),
    createdAt: existing?.createdAt ?? new Date(timestamp).toISOString(),
  };
}

function redactMessageText(value) {
  const input = typeof value === "string" ? value : "";
  const clipped = Buffer.byteLength(input, "utf8") > MAX_MESSAGE_BYTES
    ? Buffer.from(input, "utf8").subarray(0, MAX_MESSAGE_BYTES).toString("utf8")
    : input;
  return clipped
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{12,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g, "[redacted-secret]")
    .replace(/\b(?:password|passcode|otp|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .trim();
}

function classify(message) {
  const text = `${message.subject ?? ""}\n${message.text ?? ""}`;
  const sensitiveReasons = [];
  const tests = [
    ["financial", /\b(?:refunds?|payments?|charges?|charged|wire|bank|payout|credit\s+card)\b/i],
    ["account_security", /\b(?:password|passcode|login|sign\s*in|credentials?|2fa|mfa|totp|api[_ -]?key|secret|account recovery)\b/i],
    ["destructive", /\b(?:delete|erase|destroy|purge|wipe|terminate|remove all)\b/i],
    ["regulated", /\b(?:medical|patient|diagnos|legal advice|lawyer|tax advice|investment|hiring|firing|payroll)\b/i],
  ];
  for (const [reason, pattern] of tests) if (pattern.test(text)) sensitiveReasons.push(reason);
  const category = /\b(?:bug|error|broken|crash|fails?|failure)\b/i.test(text) ? "product_support"
    : /\b(?:onboarding|setup|install|getting started)\b/i.test(text) ? "onboarding"
    : /\b(?:billing|invoice|payment|charge|refund)\b/i.test(text) ? "billing"
    : "general_support";
  const urgency = /\b(?:urgent|asap|blocked|outage|emergency)\b|\b(?:service|site|system|app)\s+(?:is\s+)?down\b/i.test(text) ? "urgent" : "normal";
  return { category, urgency, sensitiveReasons, requiresReview: sensitiveReasons.length > 0 };
}

function replyFor(classification) {
  if (classification.category === "product_support") return "Thanks for the report. We have recorded the issue for review. Please reply with the expected result and any non-sensitive reproduction details you can share.";
  if (classification.category === "onboarding") return "Thanks for reaching out. We have recorded your onboarding request and will follow the approved support path for the next step.";
  return "Thanks for contacting SolveLang support. We have recorded your request and will follow the approved support workflow for the next step.";
}

function eventIdFor(message) {
  return `gmail:${cleanText(message.id, "Provider event ID", 256)}`;
}

function subjectFor(message) {
  const subject = cleanText(message.subject || "Support request", "Subject", 180);
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

export function createSupportAutomationService({
  store,
  gmail,
  linear,
  activationEnabled = false,
  now = Date.now,
  idFactory = randomUUID,
  logger = console,
}) {
  if (!store || !gmail || !linear) throw new Error("Support automation store and provider adapters are required.");

  async function status(session) {
    const accountId = assertSession(session);
    const config = await store.getConfig(accountId);
    if (!config) return { configured: false, automationState: "NOT_CONFIGURED", activationEnabled: Boolean(activationEnabled) };
    return {
      configured: true,
      automationState: config.automationState,
      provider: config.provider,
      inboxEmail: config.inboxEmail,
      taskProvider: config.taskProvider,
      linearTeamId: config.linearTeamId,
      policyVersion: config.policyVersion,
      allowedActions: [...config.allowedActions],
      revision: config.revision,
      updatedAt: config.updatedAt,
      activationEnabled: Boolean(activationEnabled),
    };
  }

  async function configure(session, input) {
    const accountId = assertSession(session);
    const existing = await store.getConfig(accountId);
    const config = normalizeConfiguration(accountId, input, now(), existing);
    await store.putConfig(config, existing?.revision);
    return { ...(await status(session)), message: "Configuration saved in paused state. Live processing remains off until separately enabled and resumed." };
  }

  async function pause(session) {
    const accountId = assertSession(session);
    const config = await store.getConfig(accountId);
    if (!config) throw new ApiAccessError(404, "support_automation_not_configured", "Support automation is not configured.");
    const updated = await store.setState(accountId, config.revision, "PAUSED", new Date(now()).toISOString());
    return { automationState: updated.automationState, revision: updated.revision, paused: true };
  }

  async function resume(session) {
    const accountId = assertSession(session);
    if (!activationEnabled) throw new ApiAccessError(503, "support_automation_activation_disabled", "Support automation activation is not enabled for this environment.");
    const config = await store.getConfig(accountId);
    if (!config) throw new ApiAccessError(404, "support_automation_not_configured", "Support automation is not configured.");
    if (config.automationState === "REVOKED") throw new ApiAccessError(409, "support_automation_revoked", "Revoked support automation credentials must be configured again before activation.");
    const updated = await store.setState(accountId, config.revision, "ACTIVE", new Date(now()).toISOString());
    return { automationState: updated.automationState, revision: updated.revision, resumed: true };
  }

  async function revoke(session) {
    const accountId = assertSession(session);
    const config = await store.getConfig(accountId);
    if (!config) return { automationState: "NOT_CONFIGURED", revoked: true };
    const updated = await store.revokeConfig(accountId, config.revision, new Date(now()).toISOString());
    return { automationState: updated.automationState, revision: updated.revision, revoked: true };
  }

  async function history(session, limit = 20) {
    const accountId = assertSession(session);
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
    const records = await store.listEvents(accountId, safeLimit);
    return records.map((record) => ({
      eventId: record.eventId,
      state: record.state,
      category: record.category,
      urgency: record.urgency,
      requiresReview: Boolean(record.requiresReview),
      actions: record.actions ?? [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      providerMessageHash: record.providerMessageHash,
    }));
  }

  async function currentActiveConfig(accountId, expectedRevision) {
    const latest = await store.getConfig(accountId);
    if (!latest || latest.automationState !== "ACTIVE" || latest.revision !== expectedRevision) return undefined;
    return latest;
  }

  async function runExternalAction({ accountId, eventId, actionId, configRevision, execute }) {
    const claimed = await store.claimAction({ accountId, eventId, actionId, createdAt: new Date(now()).toISOString(), claimId: idFactory() });
    if (claimed.status === "succeeded") return { status: "succeeded", duplicate: true, outcome: claimed.outcome };
    if (claimed.status === "started" || claimed.status === "unknown") return { status: "unknown", duplicate: true };
    const current = await currentActiveConfig(accountId, configRevision);
    if (!current) {
      await store.finishAction({ accountId, eventId, actionId, status: "stopped", updatedAt: new Date(now()).toISOString() });
      return { status: "stopped" };
    }
    try {
      const outcome = await execute(current);
      await store.finishAction({ accountId, eventId, actionId, status: "succeeded", outcome, updatedAt: new Date(now()).toISOString() });
      return { status: "succeeded", outcome };
    } catch (error) {
      await store.finishAction({ accountId, eventId, actionId, status: "unknown", updatedAt: new Date(now()).toISOString() });
      logger.error({ type: "support_automation_action_unknown", actionId, eventId, accountId });
      return { status: "unknown" };
    }
  }

  async function finishEvent(config, eventId, claimId, classification, state, actions) {
    await store.finishEvent({
      accountId: config.accountId,
      eventId,
      claimId,
      state,
      ...classification,
      actions,
      updatedAt: new Date(now()).toISOString(),
    });
  }

  async function processMessage(config, message) {
    const eventId = eventIdFor(message);
    const timestampMs = now();
    const timestamp = new Date(timestampMs).toISOString();
    const claimId = idFactory();
    const sanitized = redactMessageText(message.text);
    const providerMessageHash = createHash("sha256").update(`${message.id}\n${message.from}\n${message.subject}\n${sanitized}`).digest("hex");
    const claimed = await store.claimEvent({
      accountId: config.accountId,
      eventId,
      providerMessageHash,
      claimId,
      processingUntil: new Date(timestampMs + EVENT_LEASE_MS).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (!claimed.created) return { eventId, state: claimed.record.state, duplicate: true };
    const activeClaimId = claimed.record?.claimId ?? claimId;
    const classification = classify({ ...message, text: sanitized });
    if (classification.requiresReview) {
      await finishEvent(config, eventId, activeClaimId, classification, "REVIEW_REQUIRED", []);
      return { eventId, state: "REVIEW_REQUIRED", duplicate: false, reclaimed: Boolean(claimed.reclaimed) };
    }

    const actions = [];
    if (config.allowedActions.includes("create_linear_issue")) {
      const task = await runExternalAction({
        accountId: config.accountId,
        eventId,
        actionId: "linear_issue",
        configRevision: config.revision,
        execute: (current) => linear.createIssue({
          credentialSecretArn: current.linearCredentialSecretArn,
          teamId: current.linearTeamId,
          title: `[${classification.urgency}] ${message.subject || "Support request"}`,
          description: `Support message ${eventId}\nFrom: ${message.from}\n\n${sanitized}`,
        }),
      });
      actions.push({ action: "create_linear_issue", status: task.status, reference: task.outcome?.url ?? task.outcome?.id });
      if (task.status !== "succeeded") {
        const state = task.status === "stopped" ? "STOPPED" : "OUTCOME_UNKNOWN";
        await finishEvent(config, eventId, activeClaimId, classification, state, actions);
        return { eventId, state, duplicate: false, reclaimed: Boolean(claimed.reclaimed) };
      }
    }

    if (config.allowedActions.includes("send_reply")) {
      const reply = await runExternalAction({
        accountId: config.accountId,
        eventId,
        actionId: "gmail_reply",
        configRevision: config.revision,
        execute: (current) => gmail.sendReply({
          credentialSecretArn: current.gmailCredentialSecretArn,
          mailbox: current.inboxEmail,
          threadId: message.threadId,
          to: message.from,
          subject: subjectFor(message),
          text: replyFor(classification),
          inReplyTo: message.rfcMessageId,
        }),
      });
      actions.push({ action: "send_reply", status: reply.status, reference: reply.outcome?.id });
      if (reply.status !== "succeeded") {
        const state = reply.status === "stopped" ? "STOPPED" : "OUTCOME_UNKNOWN";
        await finishEvent(config, eventId, activeClaimId, classification, state, actions);
        return { eventId, state, duplicate: false, reclaimed: Boolean(claimed.reclaimed) };
      }
    }

    await finishEvent(config, eventId, activeClaimId, classification, "PROCESSED", actions);
    return { eventId, state: "PROCESSED", duplicate: false, reclaimed: Boolean(claimed.reclaimed) };
  }

  async function acknowledgeIfSafe(config, messageId, result) {
    if (!TERMINAL_EVENT_STATES.has(result.state)) return { ...result, acknowledgement: "deferred" };
    const current = await currentActiveConfig(config.accountId, config.revision);
    if (!current) return { ...result, acknowledgement: "deferred" };
    try {
      await gmail.markRead({ credentialSecretArn: current.gmailCredentialSecretArn, mailbox: current.inboxEmail, id: messageId });
      return { ...result, acknowledgement: "read" };
    } catch (error) {
      logger.error({ type: "support_automation_acknowledgement_failed", accountId: config.accountId, eventId: result.eventId });
      return { ...result, acknowledgement: "failed" };
    }
  }

  async function processAccount(config) {
    const latest = await currentActiveConfig(config.accountId, config.revision);
    if (!latest) return { accountId: config.accountId, state: "STOPPED", processed: [] };
    const profile = await gmail.getProfile({ credentialSecretArn: latest.gmailCredentialSecretArn, mailbox: latest.inboxEmail });
    if (cleanEmail(profile.emailAddress, "Provider mailbox") !== latest.inboxEmail) {
      await store.setState(latest.accountId, latest.revision, "PAUSED", new Date(now()).toISOString());
      logger.error({ type: "support_automation_source_identity_mismatch", accountId: latest.accountId });
      return { accountId: latest.accountId, state: "SOURCE_IDENTITY_MISMATCH", processed: [] };
    }
    const messages = await gmail.listUnread({ credentialSecretArn: latest.gmailCredentialSecretArn, mailbox: latest.inboxEmail, limit: 5 });
    const processed = [];
    for (const summary of messages.slice(0, 5)) {
      const beforeRead = await currentActiveConfig(latest.accountId, latest.revision);
      if (!beforeRead) break;
      const message = await gmail.getMessage({ credentialSecretArn: beforeRead.gmailCredentialSecretArn, mailbox: beforeRead.inboxEmail, id: summary.id });
      const result = await processMessage(beforeRead, message);
      processed.push(await acknowledgeIfSafe(beforeRead, message.id, result));
    }
    return { accountId: latest.accountId, state: "ACTIVE", processed };
  }

  async function processTick(limit = 10) {
    if (!activationEnabled) return { activationEnabled: false, accounts: [] };
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 25) : 10;
    const configs = await store.listActiveConfigs(safeLimit);
    const accounts = [];
    for (const config of configs) {
      try { accounts.push(await processAccount(config)); }
      catch (error) {
        logger.error({ type: "support_automation_account_failed", accountId: config.accountId });
        accounts.push({ accountId: config.accountId, state: "FAILED", processed: [] });
      }
    }
    return { activationEnabled: true, accounts };
  }

  return { status, configure, pause, resume, revoke, history, processTick, processAccount, processMessage };
}

export const supportAutomationInternals = { classify, redactMessageText, normalizeConfiguration };
