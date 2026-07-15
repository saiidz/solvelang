import type { ProductEventName } from "./types";

const KEY = "solvelang.studio.analytics.v1";
type Counter = { count: number; lastOccurredAt: string };

export function createLocalAnalytics(storage: Storage) {
  const read = (): Partial<Record<ProductEventName, Counter>> => {
    try { return JSON.parse(storage.getItem(KEY) ?? "{}"); } catch { return {}; }
  };
  return {
    track(name: ProductEventName) {
      const snapshot = read();
      snapshot[name] = { count: (snapshot[name]?.count ?? 0) + 1, lastOccurredAt: new Date().toISOString() };
      storage.setItem(KEY, JSON.stringify(snapshot));
    },
    snapshot: read,
  };
}
