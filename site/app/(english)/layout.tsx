import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { brandFacts } from "../brandFacts";
import { JsonLd } from "../components/JsonLd";
import { LanguageSuggestion } from "../components/LanguageSuggestion";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "SolveLang — Readable, Explainable Workflows for AI-Assisted Business Processes";
const description = brandFacts.shortDefinition;

export const metadata: Metadata = {
  metadataBase: new URL(brandFacts.canonicalDomain),
  applicationName: brandFacts.publicName,
  title: {
    default: title,
    template: "%s | SolveLang",
  },
  description,
  keywords: [
    "workflow language",
    "workflow as code",
    "AI-assisted workflows",
    "business process automation",
    "human in the loop workflow",
    "workflow analysis",
    "workflow preflight",
  ],
  openGraph: {
    siteName: brandFacts.publicName,
    title,
    description,
    url: `${brandFacts.canonicalDomain}/`,
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

const organizationId = `${brandFacts.canonicalDomain}/#organization`;
const websiteId = `${brandFacts.canonicalDomain}/#website`;
const softwareId = `${brandFacts.canonicalDomain}/#software`;
const sourceId = `${brandFacts.canonicalDomain}/#source-code`;

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: brandFacts.publicName,
      alternateName: brandFacts.alternateNames,
      url: `${brandFacts.canonicalDomain}/`,
      logo: `${brandFacts.canonicalDomain}/solvelang-mark.svg`,
      email: brandFacts.contactInformation.email,
      description: brandFacts.shortDefinition,
      sameAs: brandFacts.officialSocialProfiles,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: brandFacts.publicName,
      alternateName: brandFacts.alternateNames,
      url: `${brandFacts.canonicalDomain}/`,
      description: brandFacts.shortDefinition,
      publisher: { "@id": organizationId },
    },
    {
      "@type": "SoftwareApplication",
      "@id": softwareId,
      name: brandFacts.publicName,
      url: `${brandFacts.canonicalDomain}/`,
      image: `${brandFacts.canonicalDomain}/solvelang-logo.svg`,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Workflow language and analysis tooling",
      description: brandFacts.fullDescription,
      featureList: brandFacts.features,
      isAccessibleForFree: true,
      publisher: { "@id": organizationId },
      sameAs: [brandFacts.officialSocialProfiles[0]],
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": sourceId,
      name: "SolveLang source code",
      codeRepository: brandFacts.officialSocialProfiles[0],
      programmingLanguage: ["Rust", "TypeScript", "JavaScript"],
      runtimePlatform: "Rust CLI and web tooling",
      description:
        "Open-source source code for the early-beta SolveLang language runtime, CLI, browser tooling, documentation, and experimental test-mode API infrastructure.",
      license: "https://github.com/saiidz/solvelang/blob/main/LICENSE",
      targetProduct: { "@id": softwareId },
      publisher: { "@id": organizationId },
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
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <JsonLd id="site-json-ld" data={siteJsonLd} />
        {children}
        <LanguageSuggestion countryHintEndpoint={process.env.NEXT_PUBLIC_COUNTRY_HINT_ENDPOINT ?? ""} />
      </body>
    </html>
  );
}
