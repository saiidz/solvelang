import type { PreflightReport } from "./n8nPreflight";

export type PendingPaidScan = {
  scanId: string;
  report: PreflightReport;
  fileName: string;
};

type RecoveryResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

type RecoveryOptions = {
  apiBase: string;
  search: string;
  stored: string | null;
  verify(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<RecoveryResponse>;
  replaceUrl(url: string): void;
  clearPending(): void;
};

function parseToken(value: unknown): string {
  if (!value || typeof value !== "object" || !("token" in value) || typeof value.token !== "string" || !value.token) {
    throw new Error("Payment could not be verified.");
  }
  return value.token;
}

export async function recoverPaidScan(options: RecoveryOptions): Promise<{ pending: PendingPaidScan; token: string } | null> {
  const params = new URLSearchParams(options.search);
  const returnedScanId = params.get("scan_id");
  const sessionId = params.get("session_id");
  if (!returnedScanId || !sessionId || !options.stored || !options.apiBase) return null;

  const pending = JSON.parse(options.stored) as PendingPaidScan;
  if (pending.scanId !== returnedScanId) throw new Error("The returned checkout does not match this scan.");

  const response = await options.verify(`${options.apiBase}/entitlement`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scanId: returnedScanId, sessionId }),
  });
  if (!response.ok) throw new Error("Payment could not be verified.");
  const token = parseToken(await response.json());

  options.clearPending();
  options.replaceUrl("/check/");
  return { pending, token };
}
