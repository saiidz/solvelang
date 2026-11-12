import type { Metadata } from "next";
import { SettingsPane } from "../../../components/account-shell/AccountSidebar";

export const metadata: Metadata = {
  title: "Support Automation",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function SupportAutomationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SettingsPane active="support-automation">{children}</SettingsPane>;
}
