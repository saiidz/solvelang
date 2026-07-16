import type { ProductEventName } from "./types";

const KEY = "solvelang.studio.analytics.v1";
type Counter = { count: number; lastOccurredAt: string };

export function createLocalAnalytics(storage: Storage) {
  const read = (): Partial<Record<ProductEventName, Counter>> => {
    try {
      const parsed = JSON.parse(storage.getItem(KEY) ?? "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && typeof value === "object" && Number.isInteger((value as Counter).count) && (value as Counter).count >= 0 && typeof (value as Counter).lastOccurredAt === "string"));
    } catch { return {}; }
  };
  return {
    track(name: ProductEventName) {
      const snapshot = read();
      snapshot[name] = { count: (snapshot[name]?.count ?? 0) + 1, lastOccurredAt: new Date().toISOString() };
      try { storage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* Aggregate counters must never break Studio workflows. */ }
    },
    snapshot: read,
  };
}
