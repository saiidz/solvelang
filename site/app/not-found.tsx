import "./globals.css";
import Link from "next/link";
import legalContent from "./legal-content.json";

export const metadata = {
  title: "Page not found",
  description: "The requested page is not available. The route was checked and labeled failed — with working exits to SolveLang's home, free tools, status, and documentation.",
};

const mono = { fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

const receiptRows = [
  { check: "Requested route is a published page", status: "failed", tone: "text-danger" },
  { check: "Content delivered for this address", status: "failed", tone: "text-danger" },
  { check: "This receipt, served by the live site", status: "verified", tone: "text-success" },
] as const;

const exits = [
  {
    href: "/security-scan/",
    title: "Free repo security scan",
    note: "Run it on any public repository. Every finding is graded verified, failed, or unverified.",
  },
  {
    href: "/ci-bill-check/",
    title: "Free CI bill check",
    note: "Price a repository's recent real runs under GitHub's per-minute rounding and per-second metering.",
  },
  {
    href: "/status/",
    title: "System status",
    note: "Recent public health observations and the preserved incident history.",
  },
  {
    href: "/docs/",
    title: "Documentation",
    note: "The language, the tools, and how the receipts are built.",
  },
] as const;

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="shrink-0 border-b border-chrome-line bg-chrome text-chrome-text">
        <nav aria-label="Primary navigation" className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" aria-label="SolveLang home" className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/solvelang-logo.svg" alt="SolveLang" width={194} height={41} className="h-auto w-32 sm:w-40" />
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/status/" className="rounded-lg px-2 py-2 text-sm font-semibold text-chrome-text hover:bg-chrome-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Status</Link>
            <Link href="/docs/" className="rounded-lg px-2 py-2 text-sm font-semibold text-chrome-text hover:bg-chrome-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Docs</Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 py-14 text-center sm:py-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/solvelang-mark.svg" alt="" width={256} height={256} className="mx-auto h-24 w-24" />
          <p className="mt-8 text-sm font-semibold text-accent">404 · Route check</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">This page doesn&rsquo;t exist.</h1>
          <p className="mx-auto mt-5 max-w-2xl leading-7 text-muted">
            SolveLang grades evidence for a living, so here is the honest receipt for this address: the route was
            checked, and it did not pass. A page that isn&rsquo;t here is labeled failed — never dressed up as verified.
          </p>

          <section aria-label="Route receipt" className="mt-10 rounded-3xl border border-line bg-panel p-6 text-left shadow-sm sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Route receipt</h2>
              <span className="rounded-full bg-danger-soft px-3 py-1 text-xs font-semibold text-danger" style={mono}>HTTP 404</span>
            </div>
            <div className="mt-4 divide-y divide-line" style={mono}>
              {receiptRows.map((row) => (
                <div key={row.check} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
                  <span className="text-body">{row.check}</span>
                  <span className={`font-semibold uppercase ${row.tone}`}>{row.status}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">
              That is the whole grading rule: what was checked and failed is labeled failed, what was checked and
              passed is labeled verified, and a fact that was not checked would be labeled unverified. We don&rsquo;t
              guess either way.
            </p>
          </section>

          <div className="mt-10">
            <Link href="/" className="inline-block rounded-lg bg-accent-solid px-5 py-3 font-semibold text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Return to SolveLang home
            </Link>
          </div>

          <section aria-label="Working exits" className="mt-12 text-left">
            <h2 className="text-center text-lg font-semibold">Verified exits from this dead end</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {exits.map((exit) => (
                <Link key={exit.href} href={exit.href} className="rounded-3xl border border-line bg-panel p-5 shadow-sm transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <span className="font-semibold text-accent">{exit.title}</span>
                  <span className="mt-2 block text-sm leading-6 text-muted">{exit.note}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/10 bg-[#0a0e1a] px-6 py-4 text-sm leading-6 text-slate-300 sm:py-6 sm:leading-7">
        <nav aria-label="Policies and business contact" className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 sm:gap-x-5 sm:gap-y-2">
          <Link href="/privacy-policy/">Privacy policy</Link>
          <Link href="/terms/">Terms of use</Link>
          <Link href="/refund-policy/">Refund policy</Link>
          <a href={`mailto:${legalContent.supportEmail}`}>{legalContent.supportEmail}</a>
        </nav>
        <p className="mx-auto mt-2 max-w-6xl text-slate-400">Operator: {legalContent.operator}.</p>
      </footer>
    </div>
  );
}
