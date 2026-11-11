import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "This page has moved to the SolveLang privacy policy.",
  alternates: { canonical: "https://www.solve-lang.com/privacy-policy/" },
};

export default function PrivacyRedirectPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <meta httpEquiv="refresh" content="0; url=/privacy-policy/" />
      <section className="mx-auto max-w-4xl rounded-3xl border bg-panel p-8 sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">SolveLang privacy</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">This page has moved</h1>
        <p className="mt-5 leading-7 text-body">The SolveLang privacy policy now lives at its canonical address. You are being redirected automatically.</p>
        <Link className="mt-8 inline-flex rounded-xl bg-canvas px-5 py-3 font-semibold text-ink hover:bg-panel-alt" href="/privacy-policy/">Go to the privacy policy</Link>
      </section>
    </main>
  );
}
