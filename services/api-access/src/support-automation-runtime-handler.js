import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccessGuardedCustomerAuthStore } from "./customer-auth-access-guard.js";
import { createDynamoCustomerAuthStore } from "./customer-auth-store.js";
import { createCustomerAuthService } from "./customer-auth.js";
import { createSupportAutomationApiHandler } from "./support-automation-api-handler.js";
import { createGmailSupportProvider, createLinearSupportProvider, createSecretsManagerCredentialResolver } from "./support-automation-providers.js";
import { createDynamoSupportAutomationStore } from "./support-automation-store.js";
import { createSupportAutomationService } from "./support-automation.js";

function required(environment, name, minimum = 1) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

function accountIdFromSupportSecret(secretArn) {
  const match = String(secretArn ?? "").match(/:secret:solvelang\/support-automation\/(acct_[a-f0-9]{32})\//);
  if (!match) throw new Error("Support automation provider credential reference is not tenant scoped.");
  return match[1];
}

export function createAccountAccessGuardedSupportProvider(provider, accessReader) {
  if (!provider || !accessReader || typeof accessReader.isActive !== "function") throw new Error("Support provider account-access guard requires a provider and account reader.");
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (input, ...rest) => {
        const accountId = accountIdFromSupportSecret(input?.credentialSecretArn);
        if (!await accessReader.isActive(accountId)) throw new Error("Support automation account access is restricted.");
        return value.call(target, input, ...rest);
      };
    },
  });
}

export function createAccountAccessGuardedSupportStore(store, accessReader, { now = Date.now, logger = console } = {}) {
  if (!store || typeof store.listActiveConfigs !== "function" || !accessReader || typeof accessReader.isActive !== "function") {
    throw new Error("Support automation account-access guard requires a store and account reader.");
  }
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "listActiveConfigs") return Reflect.get(target, property, receiver);
      return async (limit) => {
        const configs = await target.listActiveConfigs(limit);
        const allowed = [];
        for (const config of configs) {
          if (await accessReader.isActive(config.accountId)) {
            allowed.push(config);
            continue;
          }
          try {
            await target.setState(config.accountId, config.revision, "PAUSED", new Date(now()).toISOString());
          } catch {
            logger.error({ type: "support_automation_account_restriction_pause_failed", accountId: config.accountId });
          }
        }
        return allowed;
      };
    },
  });
}

export function parseSupportAutomationRuntimeEnvironment(environment = process.env) {
  const enabled = environment.API_SUPPORT_AUTOMATION_ENABLED === "true";
  const activationEnabled = environment.API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED === "true";
  if (activationEnabled && !enabled) throw new Error("Support automation activation requires support automation to be enabled.");
  return {
    enabled,
    activationEnabled,
    siteOrigin: required(environment, "SITE_ORIGIN"),
    supportAutomationTable: enabled ? required(environment, "API_SUPPORT_AUTOMATION_TABLE") : undefined,
    customerAuthTable: enabled ? required(environment, "API_CUSTOMER_AUTH_TABLE") : undefined,
    customerAuthPepper: enabled ? required(environment, "API_CUSTOMER_AUTH_PEPPER", 32) : undefined,
  };
}

export function createSupportAutomationRuntime({
  environment = process.env,
  documentClient,
  secretsManager,
  logger = console,
} = {}) {
  const parsed = parseSupportAutomationRuntimeEnvironment(environment);
  if (!parsed.enabled) {
    const application = createSupportAutomationApiHandler({ enabled: false, siteOrigin: parsed.siteOrigin, logger });
    return {
      application,
      async worker() { return { activationEnabled: false, accounts: [] }; },
      environment: parsed,
    };
  }

  const dynamo = documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const secrets = secretsManager ?? new SecretsManagerClient({});
  const rawAuthStore = createDynamoCustomerAuthStore(dynamo, parsed.customerAuthTable);
  const accessReader = createDynamoAccountAccessReader(dynamo, { tableName: parsed.customerAuthTable });
  const guardedAuthStore = createAccessGuardedCustomerAuthStore(rawAuthStore, accessReader);
  const customerAuth = createCustomerAuthService({
    store: guardedAuthStore,
    emailGateway: {
      async sendMagicLink() {
        throw new Error("The support-automation runtime cannot send authentication emails.");
      },
    },
    pepper: parsed.customerAuthPepper,
    siteOrigin: parsed.siteOrigin,
  });

  const supportStore = createDynamoSupportAutomationStore(dynamo, parsed.supportAutomationTable);
  const guardedSupportStore = createAccountAccessGuardedSupportStore(supportStore, accessReader, { logger });
  const credentialResolver = createSecretsManagerCredentialResolver(secrets);
  const supportAutomation = createSupportAutomationService({
    store: guardedSupportStore,
    gmail: createAccountAccessGuardedSupportProvider(createGmailSupportProvider({ credentialResolver }), accessReader),
    linear: createAccountAccessGuardedSupportProvider(createLinearSupportProvider({ credentialResolver }), accessReader),
    activationEnabled: parsed.activationEnabled,
    logger,
  });

  const application = createSupportAutomationApiHandler({
    enabled: true,
    supportAutomation,
    customerAuth,
    siteOrigin: parsed.siteOrigin,
    logger,
  });

  return {
    application,
    async worker() { return supportAutomation.processTick(10); },
    environment: parsed,
  };
}

let runtime;
function currentRuntime() {
  runtime ??= createSupportAutomationRuntime();
  return runtime;
}

export async function handler(event) {
  return currentRuntime().application(event);
}

export async function worker() {
  return currentRuntime().worker();
}
