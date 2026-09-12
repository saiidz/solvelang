import type { ProductEventName } from "./types";

type Counter = { count: number; lastOccurredAt: string };

export function createLocalAnalytics(storage: Storage) {
  let counters: Partial<Record<ProductEventName, Counter>> = {};
  try { storage.removeItem("solvelang.studio.analytics.v1"); } catch { /* Storage can be unavailable. */ }
  return {
    track(name: ProductEventName) {
      counters = { ...counters, [name]: { count: (counters[name]?.count ?? 0) + 1, lastOccurredAt: new Date().toISOString() } };
    },
    snapshot: () => structuredClone(counters),
  };
}
