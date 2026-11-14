import type { Metadata } from "next";
import { AccountHome } from "@/app/account/home/AccountHome";

export const metadata: Metadata = {
  title: "Your Account",
  description: "Your SolveLang account home — your API keys and credits, the Live Center, and your runner minutes balance.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountHome />;
}
