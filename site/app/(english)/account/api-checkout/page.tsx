import type { Metadata } from "next";
import { EmbeddedApiCheckout } from "@/app/account/api-checkout/EmbeddedApiCheckout";

export const metadata: Metadata = {
  title: "API Subscription Checkout | SolveLang",
  description: "Subscribe to a SolveLang API plan through a secure embedded Stripe checkout.",
  robots: { index: false, follow: false },
};

export default function ApiSubscriptionCheckoutPage() {
  return <EmbeddedApiCheckout />;
}
