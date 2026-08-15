import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolveLang Admin",
  description: "Private SolveLang operations and CRM console",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
