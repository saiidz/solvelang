import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { JsonLd } from "./components/JsonLd";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.solve-lang.com"),
  applicationName: "SolveLang",
  title: {
    default: "SolveLang — Workflow X-Ray for Founder-Led Operations",
    template: "%s",
  },
  description:
    "SolveLang turns messy support, intake, lead routing, and internal ops workflows into readable automation blueprints, human review points, and SolveLang-style workflow drafts.",
  openGraph: {
    siteName: "SolveLang",
    title: "SolveLang — Workflow X-Ray for Founder-Led Operations",
    description:
      "SolveLang turns messy support, intake, lead routing, and internal ops workflows into readable automation blueprints, human review points, and SolveLang-style workflow drafts.",
    url: "https://www.solve-lang.com/",
    type: "website",
  },
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.solve-lang.com/#organization",
      name: "SolveLang",
      url: "https://www.solve-lang.com/",
      email: "hello@solve-lang.com",
    },
    {
      "@type": "WebSite",
      "@id": "https://www.solve-lang.com/#website",
      name: "SolveLang",
      url: "https://www.solve-lang.com/",
      publisher: {
        "@id": "https://www.solve-lang.com/#organization",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.solve-lang.com/#software",
      name: "SolveLang",
      url: "https://www.solve-lang.com/",
      email: "hello@solve-lang.com",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, macOS, Linux",
      description:
        "SolveLang turns messy support, intake, lead routing, and internal ops workflows into readable automation blueprints, human review points, and SolveLang-style workflow drafts.",
      featureList: [
        "Readable workflow scripts",
        "Workflow X-Ray audits",
        "Browser-safe preview",
        "Local Rust runtime",
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <JsonLd id="site-json-ld" data={siteJsonLd} />
        {children}
      </body>
    </html>
  );
}
