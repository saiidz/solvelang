import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccessGuardedCustomerAuthStore } from "./customer-auth-access-guard.js";
import { createDynamoCustomerAuthStore } from "./customer-auth-store.js";
import { createCustomerAuthService } from "./customer-auth.js";
import { createSupportAutomationApiHandler } from "./support-automation-api-handler.js";
import { createImapSmtpSupportProvider } from "./support-automation-imap-smtp.js";
import { createGmailSupportProvider, createLinearSupportProvider, createSecretsManagerCredentialResolver } from "./support-automation-providers.js";
import { createDynamoSupportAutomationStore } from "./support-automation-store.js";
import { createSupportAutomationService } from "./support-automation.js";

const RUNTIME_MODES = new Set(["api", "worker"]);
const DEFAULT_MESSAGE_AGE_THRESHOLD_SECONDS = 15 * 60;
function required(environment, name, minimum = 1) { const value = environment[name]; if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`); return value; }
function approvedMailHosts(value) {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string" || value.length > 2048) throw new Error("API_SUPPORT_AUTOMATION_MAIL_HOSTS is invalid.");
  const hosts = [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  if (hosts.length > 8 || hosts.some((host) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(host))) throw new Error("API_SUPPORT_AUTOMATION_MAIL_HOSTS is invalid.");
  return hosts;
}
function approvedReplyRecipients(value) {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string" || value.length > 2048) throw new Error("API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS is invalid.");
  const recipients = [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length > 8 || recipients.some((recipient) => !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(recipient))) throw new Error("API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS is invalid.");
  return recipients;
}
function messageAgeThreshold(value) {
  if (value === undefined || value === "") return DEFAULT_MESSAGE_AGE_THRESHOLD_SECONDS;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 300 || seconds > 86_400) throw new Error("API_SUPPORT_AUTOMATION_MAX_MESSAGE_AGE_SECONDS is invalid.");
  return seconds;
}
function accountIdFromSupportSecret(secretArn) { const match = String(secretArn ?? "").match(/:secret:solvelang\/support-automation\/(acct_[a-f0-9]{32})\//); if (!match) throw new Error("Support automation provider credential reference is not tenant scoped."); return match[1]; }

export function createAccountAccessGuardedSupportProvider(provider, accessReader) {
  if (!provider || !accessReader || typeof accessReader.isActive !== "function") throw new Error("Support provider account-access guard requires a provider and account reader.");
  return new Proxy(provider, { get(target, property, receiver) { const value = Reflect.get(target, property, receiver); if (typeof value !== "function") return value; return async (input, ...rest) => { const accountId = accountIdFromSupportSecret(input?.credentialSecretArn); if (!await accessReader.isActive(accountId)) throw new Error("Support automation account access is restricted."); return value.call(target, input, ...rest); }; } });
}
export function createAccountAccessGuardedSupportStore(store, accessReader, { now = Date.now, logger = console } = {}) {
  if (!store || typeof store.listActiveConfigs !== "function" || !accessReader || typeof accessReader.isActive !== "function") throw new Error("Support automation account-access guard requires a store and account reader.");
  return new Proxy(store, { get(target, property, receiver) { if (property !== "listActiveConfigs") return Reflect.get(target, property, receiver); return async (limit) => { const configs = await target.listActiveConfigs(limit), allowed = []; for (const config of configs) { if (await accessReader.isActive(config.accountId)) { allowed.push(config); continue; } try { await target.setState(config.accountId, config.revision, "PAUSED", new Date(now()).toISOString()); } catch { logger.error({ type: "support_automation_account_restriction_pause_failed", accountId: config.accountId }); } } return allowed; }; } });
}
export function createMessageAgeMonitoredSupportProvider(provider, { now = Date.now, logger = console, thresholdSeconds = DEFAULT_MESSAGE_AGE_THRESHOLD_SECONDS } = {}) {
  if (!provider || typeof now !== "function" || !Number.isSafeInteger(thresholdSeconds) || thresholdSeconds < 300 || thresholdSeconds > 86_400) throw new Error("Support automation message-age monitor dependencies are invalid.");
  function observe(message) {
    const receivedAt = Date.parse(message?.receivedAt);
    if (!Number.isFinite(receivedAt)) return message;
    const ageSeconds = Math.floor((now() - receivedAt) / 1000);
    if (ageSeconds >= thresholdSeconds && ageSeconds >= 0) logger.warn?.("support_automation_message_age_exceeded");
    return message;
  }
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || (property !== "getMessage" && property !== "readMessage")) return value;
      return async (...args) => observe(await value.call(target, ...args));
    },
  });
}
export function createRuntimeImapSupportProvider({ credentialResolver, allowedHosts, allowSend = false, allowedReplyRecipients = [], initializationStartResolver = async () => undefined, providerFactory = createImapSmtpSupportProvider }) {
  if (typeof providerFactory !== "function" || typeof initializationStartResolver !== "function" || !Array.isArray(allowedReplyRecipients)) throw new Error("IMAP support provider dependencies are required.");
  const permittedRecipients = new Set(allowedReplyRecipients.map((value) => {
    const recipient = String(value ?? "").trim().toLowerCase();
    if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(recipient)) throw new Error("IMAP support reply recipient is invalid.");
    return recipient;
  }));
  const reader = providerFactory({ credentialResolver, allowedHosts, allowSend: false });
  return {
    async captureCutover(input) { return reader.captureCutover(input, await initializationStartResolver(input)); },
    scanNew: (...args) => reader.scanNew(...args),
    readMessage: (...args) => reader.readMessage(...args),
    async sendReply(input, message) {
      const recipient = typeof message?.to === "string" ? message.to.trim().toLowerCase() : "";
      if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(recipient)) {
        const error = new Error("smtp_message_invalid"); error.code = "smtp_message_invalid"; throw error;
      }
      if (!allowSend || !permittedRecipients.has(recipient)) {
        const error = new Error("smtp_reply_not_authorized"); error.code = "smtp_reply_not_authorized"; throw error;
      }
      // Recipient authority comes only from reviewed deployment configuration.
      // Incoming From/Reply-To is data to compare against that allowlist, never
      // a capability to expand the allowlist.
      const sender = providerFactory({ credentialResolver, allowedHosts, allowSend: true, allowedReplyRecipients: [...permittedRecipients] });
      return sender.sendReply(input, { ...message, to: recipient });
    },
  };
}
export function parseSupportAutomationRuntimeEnvironment(environment = process.env) {
  const enabled = environment.API_SUPPORT_AUTOMATION_ENABLED === "true", activationEnabled = environment.API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED === "true", runtimeMode = environment.API_SUPPORT_AUTOMATION_RUNTIME_MODE ?? "api";
  if (!RUNTIME_MODES.has(runtimeMode)) throw new Error("API_SUPPORT_AUTOMATION_RUNTIME_MODE must be api or worker.");
  if (activationEnabled && !enabled) throw new Error("Support automation activation requires support automation to be enabled.");
  return {
    enabled,
    activationEnabled,
    runtimeMode,
    siteOrigin: required(environment, "SITE_ORIGIN"),
    supportAutomationTable: enabled ? required(environment, "API_SUPPORT_AUTOMATION_TABLE") : undefined,
    customerAuthTable: enabled ? required(environment, "API_CUSTOMER_AUTH_TABLE") : undefined,
    customerAuthPepper: enabled && runtimeMode === "api" ? required(environment, "API_CUSTOMER_AUTH_PEPPER", 32) : undefined,
    approvedMailHosts: enabled ? approvedMailHosts(environment.API_SUPPORT_AUTOMATION_MAIL_HOSTS) : [],
    approvedReplyRecipients: enabled ? approvedReplyRecipients(environment.API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS) : [],
    mailSendEnabled: enabled && environment.API_SUPPORT_AUTOMATION_MAIL_SEND_ENABLED === "true",
    messageAgeThresholdSeconds: enabled ? messageAgeThreshold(environment.API_SUPPORT_AUTOMATION_MAX_MESSAGE_AGE_SECONDS) : DEFAULT_MESSAGE_AGE_THRESHOLD_SECONDS,
  };
}
export function createSupportAutomationRuntime({ environment = process.env, documentClient, secretsManager, logger = console, now = Date.now } = {}) {
  const parsed = parseSupportAutomationRuntimeEnvironment(environment);
  if (!parsed.enabled) { const application = createSupportAutomationApiHandler({ enabled: false, siteOrigin: parsed.siteOrigin, logger }); return { application, async worker() { return { activationEnabled: false, accounts: [] }; }, environment: parsed }; }
  const dynamo = documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const accessReader = createDynamoAccountAccessReader(dynamo, { tableName: parsed.customerAuthTable });
  const supportStore = createDynamoSupportAutomationStore(dynamo, parsed.supportAutomationTable);
  const guardedSupportStore = createAccountAccessGuardedSupportStore(supportStore, accessReader, { logger, now });
  const secrets = secretsManager ?? new SecretsManagerClient({}); const credentialResolver = createSecretsManagerCredentialResolver(secrets);
  const monitor = (provider) => createMessageAgeMonitoredSupportProvider(provider, { logger, now, thresholdSeconds: parsed.messageAgeThresholdSeconds });
  const supportAutomation = createSupportAutomationService({
    store: guardedSupportStore,
    gmail: createAccountAccessGuardedSupportProvider(monitor(createGmailSupportProvider({ credentialResolver })), accessReader),
    mail: createAccountAccessGuardedSupportProvider(monitor(createRuntimeImapSupportProvider({
      credentialResolver,
      allowedHosts: parsed.approvedMailHosts,
      allowSend: parsed.mailSendEnabled,
      allowedReplyRecipients: parsed.approvedReplyRecipients,
      initializationStartResolver: async (input) => {
        const config = await supportStore.getConfig(input?.accountId);
        if (!config || config.provider !== "imap_smtp" || config.automationState !== "INITIALIZING" || typeof config.updatedAt !== "string") throw new Error("Support automation source initialization is not active.");
        return config.updatedAt;
      },
    })), accessReader),
    linear: createAccountAccessGuardedSupportProvider(createLinearSupportProvider({ credentialResolver }), accessReader),
    allowedMailHosts: parsed.approvedMailHosts,
    activationEnabled: parsed.activationEnabled,
    logger,
    now,
  });
  let application = createSupportAutomationApiHandler({ enabled: false, siteOrigin: parsed.siteOrigin, logger });
  if (parsed.runtimeMode === "api") {
    const rawAuthStore = createDynamoCustomerAuthStore(dynamo, parsed.customerAuthTable); const guardedAuthStore = createAccessGuardedCustomerAuthStore(rawAuthStore, accessReader);
    const customerAuth = createCustomerAuthService({ store: guardedAuthStore, emailGateway: { async sendMagicLink() { throw new Error("The support-automation runtime cannot send authentication emails."); } }, pepper: parsed.customerAuthPepper, siteOrigin: parsed.siteOrigin });
    application = createSupportAutomationApiHandler({ enabled: true, supportAutomation, customerAuth, siteOrigin: parsed.siteOrigin, logger });
  }
  return { application, async worker() { if (parsed.runtimeMode !== "worker") return { activationEnabled: false, accounts: [] }; return supportAutomation.processTick(10); }, environment: parsed };
}
let runtime;
function currentRuntime() { runtime ??= createSupportAutomationRuntime(); return runtime; }
export async function handler(event) { return currentRuntime().application(event); }
export async function worker() { return currentRuntime().worker(); }
