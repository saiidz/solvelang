import type { Metadata } from "next";

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
  return <>{children}</>;
}
