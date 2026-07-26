import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Browser Preview — SolveLang",
  description:
    "Try the browser-safe SolveLang preview for simple workflow scripts. It runs locally in the browser and does not call a server.",
};

export default function RunLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
