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
  const supportStore = createDynamoSupportAutomationStore(dynamo, parsed.supportAutomationTable);
  const credentialResolver = createSecretsManagerCredentialResolver(secrets);
  const supportAutomation = createSupportAutomationService({
    store: supportStore,
    gmail: createGmailSupportProvider({ credentialResolver }),
    linear: createLinearSupportProvider({ credentialResolver }),
    activationEnabled: parsed.activationEnabled,
    logger,
  });

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
