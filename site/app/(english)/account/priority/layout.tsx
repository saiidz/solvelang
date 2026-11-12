import type { Metadata } from "next";
import { SettingsPane } from "../../../components/account-shell/AccountSidebar";

export const metadata: Metadata = {
  title: "Customer Priority",
  robots: { index: false, follow: false, noarchive: true },
};

export default function CustomerPriorityLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SettingsPane active="priority">{children}</SettingsPane>;
}
