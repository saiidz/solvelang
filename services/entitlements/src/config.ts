import { z } from "zod";

const environmentSchema = z.object({
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(12),
  STRIPE_PRICE_ID: z.string().startsWith("price_"),
  ENTITLEMENT_SIGNING_SECRET: z.string().min(32),
  ENTITLEMENTS_TABLE: z.string().min(1),
  SITE_ORIGIN: z.string().url(),
});

export type EntitlementEnvironment = z.infer<typeof environmentSchema>;

export function parseEntitlementEnvironment(environment: NodeJS.ProcessEnv | Record<string, string>): EntitlementEnvironment {
  return environmentSchema.parse(environment);
}
