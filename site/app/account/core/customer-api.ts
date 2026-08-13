export type ApiKeySummary = {
  keyId: string;
  name: string;
  mode: "test" | "live";
  prefix: string;
  lastFour: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CustomerDashboard = {
  accountId: string;
  email: string;
  csrfToken: string;
  auth: {
    username: string | null;
    passwordConfigured: boolean;
  };
  subscription: {
    plan: "developer" | "pro" | "business" | null;
    status: string;
    currentPeriodEnd: number | null;
    graceUntil: number | null;
  };
  usage: {
    period: string;
    used: number | null;
    limit: number | null;
    remaining: number | null;
  };
  keys: ApiKeySummary[];
};

export type IssuedApiKey = {
  apiKey: string;
  env: string;
  key: ApiKeySummary;
};

export class CustomerApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "CustomerApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeApiBase(value: string | undefined): string {
  const base = value?.trim().replace(/\/+$/, "") ?? "";
  if (!base) return "";
  if (!/^https:\/\//i.test(base)) throw new Error("Customer API base URL must use HTTPS.");
  return base;
}

export function magicTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const token = new URLSearchParams(raw).get("magic_token");
  return token && /^ml_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function newRequestId(): string {
  return `checkout_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function customerApi<T>(
  baseUrl: string,
  path: string,
  options: RequestInit & { csrfToken?: string } = {},
): Promise<T> {
  if (!baseUrl) throw new CustomerApiError(503, "Customer API access is not configured yet.", "customer_api_unconfigured");
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  if (options.csrfToken) headers.set("x-solvelang-csrf", options.csrfToken);

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) {
    throw new CustomerApiError(response.status, payload.error ?? "Request failed.", payload.code);
  }
  return payload as T;
}
