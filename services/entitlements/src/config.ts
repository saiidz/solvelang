import { z } from "zod";

const environmentSchema = z.object({
  ENTITLEMENT_MODE: z.enum(["test", "production"]),
  CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false"),
  DURABLE_CONFIRMATION_PROVIDER: z.enum(["disabled", "approved"]).default("disabled"),
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
  if (value.ENTITLEMENT_MODE === "production" && value.CHECKOUT_ENABLED === "true" && value.DURABLE_CONFIRMATION_PROVIDER !== "approved") {
    context.addIssue({ code: "custom", path: ["DURABLE_CONFIRMATION_PROVIDER"], message: "Production checkout requires an approved durable confirmation provider." });
  }
});

export type EntitlementEnvironment = z.infer<typeof environmentSchema>;

export function parseEntitlementEnvironment(environment: NodeJS.ProcessEnv | Record<string, string>): EntitlementEnvironment {
  return environmentSchema.parse(environment);
}
