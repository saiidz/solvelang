import { POSTHOG_SANITIZED_EXPORT_SCHEMA, type PostHogSanitizedExportV0 } from "./selfDrivingPosthogExport";
import type { PostHogResponseSanitizerInput } from "./selfDrivingPosthogReadPipeline";
import { postHogObject, postHogTimestamp } from "./selfDrivingPosthogSanitizerPrimitives";

const failure = () => new Error("PostHog feature-flag response does not satisfy the safe sanitizer contract.");
const flagKeys = new Set([
  "id", "name", "key", "filters", "deleted", "active", "archived", "created_by", "created_at", "updated_at", "version",
  "last_modified_by", "ensure_experience_continuity", "experiment_set", "experiment_set_metadata", "surveys", "features",
  "can_edit", "tags", "evaluation_contexts", "usage_dashboard", "analytics_dashboards", "has_enriched_analytics",
  "user_access_level", "creation_context", "is_remote_configuration", "has_encrypted_payloads", "status",
  "evaluation_runtime", "bucketing_identifier", "last_called_at", "_create_in_folder", "is_used_in_replay_settings", "is_eligible_for_experiment",
]);

/** Read-only structural evidence, never flag evaluation or targeting material. */
export function sanitizePostHogFlags(input: PostHogResponseSanitizerInput): PostHogSanitizedExportV0 {
  if (input.operation !== "read-feature-flags" || !/^[0-9]{1,20}$/.test(input.project) || !/^phr_[a-f0-9]{16}$/.test(input.requestId)) throw failure();
  const page = postHogObject(input.json, new Set(["count", "next", "previous", "results"]), failure);
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0 || !Array.isArray(page.results) || page.results.length > 100 || (page.count as number) < page.results.length) throw failure();
  if (page.previous !== null || (page.next !== null && (typeof page.next !== "string" || page.next.length > 2048))) throw failure();
  const records = Array.from(page.results, value => {
    const flag = postHogObject(value, flagKeys, failure);
    if (!Number.isSafeInteger(flag.id) || (flag.id as number) <= 0 || !Number.isSafeInteger(flag.version) || (flag.version as number) < 0 || typeof flag.active !== "boolean" || typeof flag.deleted !== "boolean" || typeof flag.archived !== "boolean") throw failure();
    return {
      kind: "feature-flag" as const,
      locator: `flag:${flag.id}`,
      observedAt: postHogTimestamp(flag.updated_at, failure),
      summary: "PostHog feature-flag configuration evidence.",
      dimensions: { active: flag.active, deleted: flag.deleted, archived: flag.archived, version: flag.version as number },
      sanitized: true as const,
    };
  });
  const omitted = (page.count as number) - records.length;
  if ((page.next !== null) !== (omitted > 0)) throw failure();
  return {
    schema: POSTHOG_SANITIZED_EXPORT_SCHEMA, sanitized: true,
    source: {
      projectLocator: `project:${input.project}`, exportLocator: `request:${input.requestId}`,
      coverage: omitted > 0 ? "partial" : "complete",
      ...(omitted > 0 ? { skipped: [{ reason: "export-truncated" as const, count: omitted }] } : {}),
    },
    records,
  };
}
