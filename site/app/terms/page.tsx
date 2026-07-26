import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms of Use for SolveLang services operated by UPCOMINGSOUNDS S.R.L.",
  alternates: { canonical: "/terms/" },
};

const sections = [
  ["Acceptance, eligibility, and operator", [
    "These Terms of Use (Terms) govern use of SolveLang. By using SolveLang or purchasing a Workflow Preflight report, you agree to these Terms. You must be able to enter into a binding agreement or use the service with permission from a parent, guardian, or authorized organization representative.",
    "SolveLang is operated by UPCOMINGSOUNDS S.R.L., Romania (Operator). These Terms are effective as of version 2026-07-26-v2. Contact the Operator at hello@solve-lang.com. Production checkout remains blocked until the Operator has verified and published its registered office, telephone number, trade-register details, CUI, VAT treatment, and final consumer price information.",
  ]],
  ["Automated outputs and customer review", [
    "SolveLang provides automated workflow analysis, reports, digital entitlements, requests, credits, and related services. Available features may change, and some features may be previews or limited releases.",
    "Reports and other automated outputs may be incomplete, inaccurate, outdated, or unsuitable for a particular workflow. They are informational only and are not legal, financial, tax, cybersecurity, compliance, medical, or other professional advice. You must independently review outputs before changing production systems.",
  ]],
  ["No guarantees", [
    "To the maximum extent permitted by applicable law, SolveLang does not guarantee uninterrupted availability, accuracy, completeness, compatibility, security, revenue, savings, business outcomes, or detection of every defect, vulnerability, or workflow problem.",
  ]],
  ["Your responsibilities", [
    "You are responsible for backups, permissions, credential security, and ensuring that you have lawful authority over submitted material. You are also responsible for regulatory compliance and for reviewing and testing any workflow change before deployment.",
  ]],
  ["Prohibited conduct", [
    "You may not submit malware, unlawful content, secrets, unauthorized personal data, or confidential data that you are not authorized to provide. You may not abuse, attack, scrape, or create excessive automated traffic; bypass payment, entitlement, Turnstile, or other security controls; reverse engineer where legally restrictable; or resell or transfer the service or purchased reports without permission.",
  ]],
  ["Third-party services", [
    "SolveLang may rely on Stripe, Cloudflare, AWS, GitHub, n8n, and other integrations. Their services, terms, privacy practices, availability, and outages are governed by their own terms and are outside the Operator's reasonable control.",
  ]],
  ["Intellectual property and license", [
    "SolveLang and its content are protected by applicable intellectual-property laws. Subject to these Terms and payment where required, the Operator grants you a limited, revocable, non-transferable license to use a purchased report for your personal or internal business purpose. No ownership is transferred.",
  ]],
  ["Payments and immediate digital performance", [
    "Payments are processed by Stripe. A purchase may start automated processing and digital delivery immediately after you give the required express consent, immediate-performance request, and withdrawal acknowledgement. The applicable Refund Policy is incorporated into these Terms by reference. A durable contract confirmation must be safely queued before a purchased report can be recovered.",
  ]],
  ["Tokens, credits, entitlements, and requests", [
    "Any token, credit, entitlement, or request allowance has no cash value and is non-transferable unless expressly stated otherwise. Capacity may be consumed when processing begins and consumed capacity cannot be returned. SolveLang does not currently promise subscriptions or token packages unless a product page expressly says otherwise.",
  ]],
  ["Suspension and termination", [
    "The Operator may suspend or terminate access for fraud, abuse, chargebacks, unlawful activity, or a security risk. This does not limit mandatory consumer rights.",
  ]],
  ["Warranty disclaimer", [
    "To the maximum extent permitted by applicable law, SolveLang is provided on an as-is and as-available basis without warranties of any kind. Mandatory consumer rights and liabilities that cannot legally be excluded remain unaffected.",
  ]],
  ["Consumer remedies and business liability", [
    "Consumers retain all mandatory statutory remedies, including remedies for failure to supply, lack of conformity, unauthorised payments, duplicate charges, and any right that cannot lawfully be excluded or limited. Nothing in these Terms limits liability for fraud, wilful misconduct, gross negligence, death or personal injury, or any other liability that cannot legally be limited.",
    "For business users only, and only to the maximum extent permitted by applicable law, the Operator is not liable for indirect, incidental, special, consequential, lost-profit, lost-data, or business-interruption damages. For an affected business purchase, the Operator's total aggregate liability is limited to the greater of the amount actually paid for that purchase or USD $49. This section does not limit mandatory consumer rights.",
  ]],
  ["Business-user indemnity", [
    "Where legally permitted, business users will indemnify the Operator for third-party claims arising from their unlawful submissions, misuse of the service, or breach of these Terms. This does not remove or limit mandatory consumer rights.",
  ]],
  ["Governing law and consumers", [
    "These Terms are governed by Romanian law. Consumers retain mandatory protections and may bring claims in courts available in their country of residence where applicable law requires.",
  ]],
  ["Changes, severability, and entire agreement", [
    "The Operator may update these Terms for future use by publishing a new effective version. If part of these Terms is unenforceable, the remaining provisions continue to apply. These Terms and the Refund Policy are the entire agreement for the relevant service, except where mandatory law provides otherwise.",
  ]],
] as const;

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/refund-policy/">Refund Policy</Link>
          <Link href="/preflight-privacy/">Workflow Preflight privacy</Link>
          <Link href="/support/">Support</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang legal</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Terms of Use</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">Effective version: 2026-07-26-v2. Operator: UPCOMINGSOUNDS S.R.L., Romania.</p>
        </header>
        <div className="mt-10 space-y-10">
          {sections.map(([heading, paragraphs]) => (
            <section key={heading} aria-labelledby={heading.toLowerCase().replaceAll(" ", "-")}>
              <h2 id={heading.toLowerCase().replaceAll(" ", "-")} className="text-2xl font-semibold tracking-tight">{heading}</h2>
              <div className="mt-4 space-y-4 leading-7 text-slate-700">
                {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <footer className="mt-14 border-t border-slate-200 pt-6 text-sm text-slate-600">
          Questions about these Terms: <a className="font-semibold text-blue-700 underline" href="mailto:hello@solve-lang.com">hello@solve-lang.com</a>.
        </footer>
      </section>
    </main>
  );
}
