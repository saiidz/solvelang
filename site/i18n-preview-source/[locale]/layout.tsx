import { localeForSegment } from "../i18n/locales";
import { JsonLd } from "../components/JsonLd";
import { LanguageSuggestion } from "../components/LanguageSuggestion";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";

// This route tree is materialized only for an explicit draft preview build.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = localeForSegment((await params).locale);
  if (!locale) {
    return <html lang="en" dir="ltr"><body>{children}</body></html>;
  }
  return (
    <html lang={locale.code} dir={locale.direction} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <JsonLd id="site-json-ld" data={{ "@context": "https://schema.org", "@type": "WebSite", name: "SolveLang", url: "https://www.solve-lang.com/" }} />
        {children}
        <LanguageSuggestion countryHintEndpoint="" />
      </body>
    </html>
  );
}
