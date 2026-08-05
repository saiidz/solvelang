import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { JsonLd } from "./components/JsonLd";
import { brandFacts } from "./brandFacts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "SolveLang — Early-Beta Workflow Language and Studio";
const description = brandFacts.fullDescription;

export const metadata: Metadata = {
  metadataBase: new URL("https://www.solve-lang.com"),
  applicationName: "SolveLang",
  title: {
    default: title,
    template: "%s | SolveLang",
  },
  description,
  keywords: [
    "workflow analysis",
    "workflow automation",
    "business process mapping",
    "human in the loop automation",
    "support triage",
    "lead routing",
    "operations automation",
  ],
  alternates: {
    canonical: "https://www.solve-lang.com/",
  },
  openGraph: {
    siteName: "SolveLang",
    title,
    description,
    url: "https://www.solve-lang.com/",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.solve-lang.com/#organization",
      name: brandFacts.publicName,
      alternateName: brandFacts.alternateNames,
      url: "https://www.solve-lang.com/",
      logo: "https://www.solve-lang.com/solvelang-mark.svg",
      email: brandFacts.contactEmail,
      slogan: "Early-beta workflow language and local-first Studio.",
      description,
      sameAs: [brandFacts.repository],
    },
    {
      "@type": "WebSite",
      "@id": "https://www.solve-lang.com/#website",
      name: brandFacts.publicName,
      alternateName: brandFacts.alternateNames,
      url: "https://www.solve-lang.com/",
      description,
      publisher: {
        "@id": "https://www.solve-lang.com/#organization",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.solve-lang.com/#software",
      name: brandFacts.publicName,
      url: "https://www.solve-lang.com/",
      image: "https://www.solve-lang.com/solvelang-logo.svg",
      email: brandFacts.contactEmail,
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Early-beta workflow language and local-first workflow analysis",
      operatingSystem: "Web preview, macOS, Linux",
      description,
      featureList: [
        "Early-beta readable workflow scripts",
        "Deterministic local workflow analysis",
        "Browser-safe preview with a smaller syntax subset",
        "Canonical local Rust runtime",
      ],
      publisher: {
        "@id": "https://www.solve-lang.com/#organization",
      },
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
