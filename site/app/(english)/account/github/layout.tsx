import type { Metadata } from "next";
import { SettingsPane } from "../../../components/account-shell/AccountSidebar";

export const metadata: Metadata = {
  title: "GitHub App",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function GitHubAccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SettingsPane active="github">{children}</SettingsPane>;
}
