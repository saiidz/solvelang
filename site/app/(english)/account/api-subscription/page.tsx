import type { Metadata } from "next";
import { SubscriptionManager } from "@/app/account/api-subscription/SubscriptionManager";

export const metadata: Metadata = {
  title: "Manage API Subscription",
  description: "Manage your SolveLang API subscription, billing method, and invoices.",
  robots: { index: false, follow: false },
};

export default function ApiSubscriptionPage() {
  return <SubscriptionManager />;
}
