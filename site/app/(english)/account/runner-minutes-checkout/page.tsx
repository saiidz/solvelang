import type { Metadata } from "next";
import { EmbeddedRunnerMinutesCheckout } from "@/app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout";

export const metadata: Metadata = {
  title: "Runner Minutes Checkout",
  description: "Buy prepaid SolveLang Runner Minutes through a secure embedded Stripe checkout.",
  robots: { index: false, follow: false },
};

export default function RunnerMinutesCheckoutPage() {
  return <EmbeddedRunnerMinutesCheckout />;
}
