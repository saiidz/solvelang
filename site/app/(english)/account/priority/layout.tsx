import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customer Priority",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CustomerPriorityLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
