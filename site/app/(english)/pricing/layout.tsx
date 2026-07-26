import type { Metadata } from 'next';
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "Pricing — SolveLang",
  description:
    "Early SolveLang pricing and custom Workflow X-Ray audit setup options for founder-led operations.",
  alternates: alternatesForRoute("pricing"),
};

export default function PricingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
