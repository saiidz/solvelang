import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { JsonLd } from "./components/JsonLd";
import { LanguageSuggestion } from "./components/LanguageSuggestion";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "SolveLang — See the System Before You Automate It";
const description =
  "SolveLang is a workflow analysis and automation language for support, intake, lead routing, approvals, and internal operations. Map decisions, exceptions, ownership, and human review before software runs the workflow.";

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
    languages: {
      en: "https://www.solve-lang.com/",
      "x-default": "https://www.solve-lang.com/",
    },
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
      name: "SolveLang",
      alternateName: "Solve Lang",
      url: "https://www.solve-lang.com/",
      logo: "https://www.solve-lang.com/solvelang-mark.svg",
      email: "hello@solve-lang.com",
      slogan: "See the system before you automate it.",
      description,
      sameAs: ["https://github.com/saiidz/solvelang"],
    },
    {
      "@type": "WebSite",
      "@id": "https://www.solve-lang.com/#website",
      name: "SolveLang",
      alternateName: "Solve Lang",
      url: "https://www.solve-lang.com/",
      description,
      publisher: {
        "@id": "https://www.solve-lang.com/#organization",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.solve-lang.com/#software",
      name: "SolveLang",
      url: "https://www.solve-lang.com/",
      image: "https://www.solve-lang.com/solvelang-logo.svg",
      email: "hello@solve-lang.com",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Workflow analysis and automation",
      operatingSystem: "Web, macOS, Linux",
      description,
      featureList: [
        "Workflow analysis",
        "Readable workflow scripts",
        "Workflow X-Ray audits",
        "Human review checkpoints",
        "Browser-safe preview",
        "Local Rust runtime",
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
        <LanguageSuggestion />
      </body>
    </html>
  );
}
