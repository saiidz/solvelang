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

export function parseApiAccessEnvironment(environment = process.env) {
  return {
    ...shared(environment),
    ...usage(environment),
    ...billing(environment),
    adminSecret: required(environment, "API_ACCESS_ADMIN_SECRET", 32),
    siteOrigin: required(environment, "SITE_ORIGIN"),
  };
}

export function parseApiKeyAuthorizerEnvironment(environment = process.env) {
  return {
    ...shared(environment),
    ...usage(environment),
  };
}
