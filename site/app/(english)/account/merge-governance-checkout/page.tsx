import type { Metadata } from "next";
import { EmbeddedMgovCheckout } from "@/app/account/merge-governance-checkout/EmbeddedMgovCheckout";

export const metadata: Metadata = {
  title: "Merge Governance Checkout",
  description: "Subscribe to SolveLang Merge Governance through a secure embedded Stripe checkout.",
  robots: { index: false, follow: false },
};

export default function MergeGovernanceCheckoutPage() {
  return <EmbeddedMgovCheckout />;
}
