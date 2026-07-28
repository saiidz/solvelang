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

export function parseApiAccessEnvironment(environment = process.env) {
  return {
    ...shared(environment),
    adminSecret: required(environment, "API_ACCESS_ADMIN_SECRET", 32),
    siteOrigin: required(environment, "SITE_ORIGIN"),
    usageTable: required(environment, "API_USAGE_TABLE"),
    idempotencyTable: required(environment, "API_USAGE_IDEMPOTENCY_TABLE"),
  };
}

export function parseApiKeyAuthorizerEnvironment(environment = process.env) {
  return shared(environment);
}
