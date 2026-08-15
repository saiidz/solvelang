function required(environment, name, minimum = 1) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

function shared(environment) {
  const mode = environment.API_ACCESS_MODE ?? "test";
  if (mode !== "test" && mode !== "live") throw new Error("API_ACCESS_MODE must be test or live.");
  return {
    enabled: environment.API_ACCESS_ENABLED === "true",
    mode,
    pepper: required(environment, "API_KEY_PEPPER", 32),
    accountsTable: required(environment, "API_ACCOUNTS_TABLE"),
    keysTable: required(environment, "API_KEYS_TABLE"),
    keysAccountIndex: environment.API_KEYS_ACCOUNT_INDEX ?? "AccountIdIndex",
  };
}

function usage(environment) {
  return {
    usageTable: required(environment, "API_USAGE_TABLE"),
    idempotencyTable: required(environment, "API_USAGE_IDEMPOTENCY_TABLE"),
  };
}

function billing(environment) {
  const enabled = environment.API_SUBSCRIPTION_BILLING_ENABLED === "true";
  return {
    subscriptionBillingEnabled: enabled,
    subscriptionEventsTable: required(environment, "API_SUBSCRIPTION_EVENTS_TABLE"),
    stripeSecretKey: enabled ? required(environment, "STRIPE_SECRET_KEY") : undefined,
    stripeWebhookSecret: enabled ? required(environment, "STRIPE_SUBSCRIPTION_WEBHOOK_SECRET") : undefined,
    priceIds: {
      developer: enabled ? required(environment, "STRIPE_API_DEVELOPER_PRICE_ID") : undefined,
      pro: enabled ? required(environment, "STRIPE_API_PRO_PRICE_ID") : undefined,
      business: enabled ? required(environment, "STRIPE_API_BUSINESS_PRICE_ID") : undefined,
    },
  };
}

function customerAccess(environment) {
  const enabled = environment.API_CUSTOMER_ACCOUNTS_ENABLED === "true";
  return {
    customerAccountsEnabled: enabled,
    customerAuthTable: enabled ? required(environment, "API_CUSTOMER_AUTH_TABLE") : undefined,
  };
}

function customerAccounts(environment) {
  const access = customerAccess(environment);
  const totpEnabled = environment.API_CUSTOMER_TOTP_ENABLED === "true";
  if (totpEnabled && !access.customerAccountsEnabled) throw new Error("Authenticator 2FA requires customer accounts to be enabled.");
  const customerTotpKmsKeyArn = totpEnabled ? required(environment, "API_CUSTOMER_TOTP_KMS_KEY_ARN") : undefined;
  if (customerTotpKmsKeyArn && !/^arn:[^:]+:kms:[^:]+:\d{12}:key\/.+/.test(customerTotpKmsKeyArn)) {
    throw new Error("API_CUSTOMER_TOTP_KMS_KEY_ARN must contain a full KMS key ARN.");
  }
  return {
    ...access,
    customerAuthPepper: access.customerAccountsEnabled ? required(environment, "API_CUSTOMER_AUTH_PEPPER", 32) : undefined,
    customerAuthEmailSender: access.customerAccountsEnabled ? required(environment, "API_CUSTOMER_AUTH_EMAIL_SENDER") : undefined,
    customerAuthEmailReplyTo: environment.API_CUSTOMER_AUTH_EMAIL_REPLY_TO || undefined,
    customerTotpEnabled: totpEnabled,
    customerTotpKmsKeyArn,
  };
}

function adminCrm(environment) {
  const enabled = environment.API_ADMIN_CRM_ENABLED === "true";
  return {
    adminCrmEnabled: enabled,
    adminCrmTable: enabled ? required(environment, "API_ADMIN_CRM_TABLE") : undefined,
    adminCrmProfileIndex: environment.API_ADMIN_CRM_PROFILE_INDEX ?? "RecordTypeUpdatedAtIndex",
  };
}

function customerPriority(environment, customerAccountsEnabled) {
  const queueEnabled = environment.API_PRIORITY_QUEUE_ENABLED === "true";
  const customerPriorityEnabled = environment.API_CUSTOMER_PRIORITY_ENABLED === "true";
  const providerExecutionEnabled = environment.API_PRIORITY_PROVIDER_EXECUTION_ENABLED === "true";
  if (customerPriorityEnabled && !customerAccountsEnabled) throw new Error("Customer priority requires customer accounts to be enabled.");
  if (customerPriorityEnabled && !queueEnabled) throw new Error("Customer priority requires the priority queue to be enabled.");
  if (providerExecutionEnabled && !customerPriorityEnabled) throw new Error("Priority provider execution requires customer priority to be enabled.");
  return {
    priorityQueueEnabled: queueEnabled,
    customerPriorityEnabled,
    priorityProviderExecutionEnabled: providerExecutionEnabled,
    priorityJobsTable: customerPriorityEnabled ? required(environment, "API_PRIORITY_JOBS_TABLE") : undefined,
    prioritySourceBucket: customerPriorityEnabled ? required(environment, "API_PRIORITY_SOURCE_BUCKET") : undefined,
  };
}

export function parseApiAccessEnvironment(environment = process.env) {
  const accounts = customerAccounts(environment);
  return {
    ...shared(environment),
    ...usage(environment),
    ...billing(environment),
    ...accounts,
    ...adminCrm(environment),
    ...customerPriority(environment, accounts.customerAccountsEnabled),
    adminSecret: required(environment, "API_ACCESS_ADMIN_SECRET", 32),
    siteOrigin: required(environment, "SITE_ORIGIN"),
  };
}

export function parseApiKeyAuthorizerEnvironment(environment = process.env) {
  return {
    ...shared(environment),
    ...usage(environment),
    ...customerAccess(environment),
  };
}
