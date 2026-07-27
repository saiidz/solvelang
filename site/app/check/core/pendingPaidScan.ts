import type { PreflightReport } from "./n8nPreflight";

export const PENDING_PAID_SCAN_STORAGE_KEY = "solvelang.preflight.pending.v1";

export type PendingPaidScan = {
  scanId: string;
  report: PreflightReport;
  fileName: string;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parsePendingPaidScan(stored: string | null): PendingPaidScan | undefined {
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as Partial<PendingPaidScan>;
    if (!isUuid(parsed.scanId) || !parsed.report || typeof parsed.report !== "object" || typeof parsed.fileName !== "string") return undefined;
    return parsed as PendingPaidScan;
  } catch {
    return undefined;
  }
}

export function rotatePendingPaidScan(stored: string | null, currentScanId: string, nextScanId: string): string | undefined {
  const pending = parsePendingPaidScan(stored);
  if (!pending || pending.scanId !== currentScanId || !isUuid(nextScanId)) return undefined;
  return JSON.stringify({ ...pending, scanId: nextScanId } satisfies PendingPaidScan);
}
