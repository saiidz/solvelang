import type { Metadata } from "next";
import { SettingsPane } from "../../../components/account-shell/AccountSidebar";

export const metadata: Metadata = {
  title: "Account Billing",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function ApiSubscriptionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SettingsPane active="api-subscription">{children}</SettingsPane>;
}
