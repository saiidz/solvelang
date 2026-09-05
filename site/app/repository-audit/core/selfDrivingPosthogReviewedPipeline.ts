import { sanitizePostHogErrors } from "./selfDrivingPosthogErrorSanitizer";
import { sanitizePostHogFlags } from "./selfDrivingPosthogFlagSanitizer";
import {
  executePostHogReadPipeline,
  PostHogReadPipelineFailure,
  type PostHogReadPipelineOptions,
  type PostHogReadPipelineResult,
  type PostHogResponseSanitizer,
} from "./selfDrivingPosthogReadPipeline";
import type { PostHogRequestPlan } from "./selfDrivingPosthogRequestPlanner";
import type { PostHogAuthProvider, PostHogTransport } from "./selfDrivingPosthogTransport";

const reviewedSanitizer: PostHogResponseSanitizer = input => {
  if (input.operation === "read-errors") return sanitizePostHogErrors(input);
  if (input.operation === "read-feature-flags") return sanitizePostHogFlags(input);
  throw new PostHogReadPipelineFailure("unsupported-operation", "No reviewed sanitizer supports this operation.");
};

// This composition owns no transport or credentials and does not activate a connection.
export function executeReviewedPostHogReadPipeline(
  plan: PostHogRequestPlan,
  authProvider: PostHogAuthProvider,
  transport: PostHogTransport,
  options: PostHogReadPipelineOptions = {},
): Promise<PostHogReadPipelineResult> {
  return executePostHogReadPipeline(plan, authProvider, transport, reviewedSanitizer, options);
}
