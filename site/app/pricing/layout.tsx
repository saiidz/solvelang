import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — SolveLang",
  description:
    "Early SolveLang pricing and custom Workflow X-Ray audit setup options for founder-led operations.",
};

export default function PricingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
