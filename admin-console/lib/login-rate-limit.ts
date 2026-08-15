type Entry = { count: number; resetAt: number };
const attempts = new Map<string, Entry>();
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 8;
const MAX_ENTRIES = 1000;

function prune(now: number) {
  for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  while (attempts.size > MAX_ENTRIES) attempts.delete(attempts.keys().next().value as string);
}

export function loginSource(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

export function canAttempt(source: string, now = Date.now()) {
  prune(now);
  const entry = attempts.get(source);
  return !entry || entry.resetAt <= now || entry.count < LIMIT;
}

export function recordFailure(source: string, now = Date.now()) {
  prune(now);
  const entry = attempts.get(source);
  if (!entry || entry.resetAt <= now) attempts.set(source, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function clearFailures(source: string) {
  attempts.delete(source);
}
