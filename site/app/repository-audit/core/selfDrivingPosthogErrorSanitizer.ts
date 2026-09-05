import { POSTHOG_SANITIZED_EXPORT_SCHEMA, type PostHogSanitizedExportV0 } from "./selfDrivingPosthogExport";
import type { PostHogResponseSanitizerInput } from "./selfDrivingPosthogReadPipeline";

const failure = () => new Error("PostHog error response does not satisfy the safe sanitizer contract.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(["active", "resolved", "suppressed", "archived", "pending_release"]);
const issueKeys = new Set(["id", "status", "severity", "name", "description", "first_seen", "assignee", "external_issues", "cohort"]);

function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) throw failure();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) throw failure();
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59 || !Number.isFinite(Date.parse(value))) throw failure();
  return new Date(value).toISOString();
}

function object(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.has(key)) throw failure();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw failure();
  }
  return value as Record<string, unknown>;
}

/** Pure, single-page sanitizer. No free text, person assignments or payloads survive. */
export function sanitizePostHogErrors(input: PostHogResponseSanitizerInput): PostHogSanitizedExportV0 {
  if (input.operation !== "read-errors" || !/^[0-9]{1,20}$/.test(input.project) || !/^phr_[a-f0-9]{16}$/.test(input.requestId)) throw failure();
  const page = object(input.json, new Set(["count", "next", "previous", "results"]));
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0 || !Array.isArray(page.results) || page.results.length > 100) throw failure();
  if ((page.count as number) < page.results.length) throw failure();
  // Links are neither followed nor copied. Reject non-first pages until offset planning is reviewed.
  if (page.previous !== null || (page.next !== null && (typeof page.next !== "string" || page.next.length > 2048))) throw failure();
  const records = Array.from(page.results, value => {
    const issue = object(value, issueKeys);
    if (typeof issue.id !== "string" || !uuid.test(issue.id) || typeof issue.status !== "string" || !statuses.has(issue.status)) throw failure();
    const observedAt = timestamp(issue.first_seen);
    // Identity-rich and arbitrary text fields are excluded as a whole, never traversed or interpolated.
    return {
      kind: "error" as const,
      locator: `issue:${issue.id.toLowerCase()}`,
      observedAt,
      summary: "PostHog tracked error issue.",
      dimensions: { status: issue.status },
      sanitized: true as const,
    };
  });
  const omitted = (page.count as number) - records.length;
  if ((page.next !== null) !== (omitted > 0)) throw failure();
  return {
    schema: POSTHOG_SANITIZED_EXPORT_SCHEMA,
    sanitized: true,
    source: {
      projectLocator: `project:${input.project}`,
      exportLocator: `request:${input.requestId}`,
      coverage: omitted > 0 ? "partial" : "complete",
      ...(omitted > 0 ? { skipped: [{ reason: "export-truncated" as const, count: omitted }] } : {}),
    },
    records,
  };
}
