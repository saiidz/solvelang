export function postHogTimestamp(value: unknown, failure: () => Error): string {
  if (typeof value !== "string" || value.length > 40) throw failure();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) throw failure();
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59 || !Number.isFinite(Date.parse(value))) throw failure();
  return new Date(value).toISOString();
}

export function postHogObject(value: unknown, keys: ReadonlySet<string>, failure: () => Error): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.has(key)) throw failure();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw failure();
  }
  return value as Record<string, unknown>;
}
