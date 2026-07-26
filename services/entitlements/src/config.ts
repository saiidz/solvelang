import { z } from "zod";

const environmentSchema = z.object({
  ENTITLEMENT_MODE: z.enum(["test", "production"]),
  CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false"),
  DURABLE_CONFIRMATION_PROVIDER: z.enum(["disabled", "test-sink", "aws-ses-sqs"]).default("disabled"),
  DURABLE_CONFIRMATION_QUEUE_URL: z.string().url().optional(),
  DURABLE_CONFIRMATION_SENDER: z.string().email().optional(),
  STRIPE_SECRET_KEY: z.string().min(12),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(12),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  ENTITLEMENT_SIGNING_SECRET: z.string().min(32),
  ENTITLEMENTS_TABLE: z.string().min(1),
  SITE_ORIGIN: z.string().url(),
}).superRefine((value, context) => {
  const expectedPrefix = value.ENTITLEMENT_MODE === "production" ? "sk_live_" : "sk_test_";
  if (!value.STRIPE_SECRET_KEY.startsWith(expectedPrefix)) {
    context.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: `STRIPE_SECRET_KEY does not match ${value.ENTITLEMENT_MODE} mode.` });
  }
  if (value.ENTITLEMENT_MODE === "production" && value.DURABLE_CONFIRMATION_PROVIDER === "test-sink") {
    context.addIssue({ code: "custom", path: ["DURABLE_CONFIRMATION_PROVIDER"], message: "Production cannot use the test-sink confirmation provider." });
  }
  if (value.ENTITLEMENT_MODE === "production" && value.CHECKOUT_ENABLED === "true" && value.DURABLE_CONFIRMATION_PROVIDER !== "aws-ses-sqs") {
    context.addIssue({ code: "custom", path: ["DURABLE_CONFIRMATION_PROVIDER"], message: "Production checkout requires the aws-ses-sqs confirmation provider." });
  }
  if (value.DURABLE_CONFIRMATION_PROVIDER === "aws-ses-sqs" && (!value.DURABLE_CONFIRMATION_QUEUE_URL || !value.DURABLE_CONFIRMATION_SENDER)) {
    context.addIssue({ code: "custom", path: ["DURABLE_CONFIRMATION_PROVIDER"], message: "aws-ses-sqs requires queue URL and verified sender configuration." });
  }
});

export type EntitlementEnvironment = z.infer<typeof environmentSchema>;

export function parseEntitlementEnvironment(environment: NodeJS.ProcessEnv | Record<string, string>): EntitlementEnvironment {
  return environmentSchema.parse(environment);
}
