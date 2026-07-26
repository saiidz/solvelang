import { parsePendingPaidScan, type PendingPaidScan } from "./pendingPaidScan";
export type { PendingPaidScan } from "./pendingPaidScan";

type RecoveryResponse = {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
};

type RecoveryOptions = {
  apiBase: string;
  search: string;
  stored: string | null;
  verify(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<RecoveryResponse>;
  replaceUrl(url: string): void;
  clearPending(): void;
  wait?(milliseconds: number): Promise<void>;
  onRetry?(attempt: number): void;
};

const RETRY_DELAYS_MS = [500, 1000, 2000];

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
}

function recoveryError(code: string | undefined): Error {
  if (code === "payment_refunded") return new Error("This payment was fully refunded and is no longer eligible.");
  if (code === "payment_not_succeeded") return new Error("Payment has not succeeded. Return to checkout to try again.");
  if (code === "payment_pending") return new Error("Payment succeeded, but verification is still pending. Retry verification in a moment.");
  return new Error("Payment could not be verified.");
}

function parseToken(value: unknown): string {
  if (!value || typeof value !== "object" || !("token" in value) || typeof value.token !== "string" || !value.token) {
    throw new Error("Payment could not be verified.");
  }
  return value.token;
}

export async function recoverPaidScan(options: RecoveryOptions): Promise<{ pending: PendingPaidScan; token: string } | null> {
  const params = new URLSearchParams(options.search);
  const returnedScanId = params.get("scan_id");
  const paymentIntentId = params.get("payment_intent");
  const redirectStatus = params.get("redirect_status");
  if (!returnedScanId || !paymentIntentId || redirectStatus !== "succeeded" || !options.stored || !options.apiBase) return null;

  const pending = parsePendingPaidScan(options.stored);
  if (!pending) throw new Error("Payment could not be verified.");
  if (pending.scanId !== returnedScanId) throw new Error("The returned payment does not match this scan.");

  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let token = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await options.verify(`${options.apiBase}/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanId: returnedScanId, sessionId: paymentIntentId }),
    });
    const body = await response.json();
    if (response.ok) {
      token = parseToken(body);
      break;
    }

    const code = errorCode(body);
    if (code !== "payment_pending" || attempt === RETRY_DELAYS_MS.length) throw recoveryError(code);
    options.onRetry?.(attempt + 1);
    await wait(RETRY_DELAYS_MS[attempt]);
  }

  options.clearPending();
  options.replaceUrl("/check/");
  return { pending, token };
}
