import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Workflow Preflight Privacy",
  description: "Privacy and data handling for SolveLang Workflow Preflight.",
  alternates: { canonical: "/preflight-privacy/" },
};

export default function PreflightPrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="mx-auto max-w-3xl px-6 py-20">
        <nav aria-label="Related legal pages" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/terms/">Terms of Use</Link>
          <Link href="/refund-policy/">Refund Policy</Link>
          <Link href="/support/">Support</Link>
        </nav>
        <h1 className="mt-8 text-4xl font-semibold">Workflow Preflight privacy</h1>
        <div className="mt-8 space-y-6 leading-7 text-slate-600">
          <p>The initial workflow scan runs in the browser. The selected JSON file is not uploaded by Workflow Preflight v1, and the scanner does not execute nodes or call workflow services.</p>
          <p>Checkout sends an opaque random scan ID, a validated receipt and contract-confirmation email, the current terms version, and required consent flags to SolveLang&apos;s entitlement API. Stripe receives the email as its receipt email, not as PaymentIntent metadata. PaymentIntent metadata is limited to the opaque scan ID, product, terms version, server-derived acceptance timestamp, and required immediate-performance and withdrawal acknowledgements. Workflow names, node parameters, credential metadata, report contents, Turnstile tokens, IP addresses, user agents, and customer email are not included in PaymentIntent metadata.</p>
          <p>The browser may temporarily store the generated report and scan ID in session storage so a successful Stripe return can restore the purchase. Session storage is scoped to the browser tab and is removed after successful entitlement verification.</p>
          <p>The entitlement service stores the opaque scan ID, Stripe PaymentIntent ID, payment and refund status, event IDs, timestamps, and automatic expiration time. It does not store the customer email in DynamoDB. DynamoDB time-to-live removes expired entitlement records.</p>
          <p>Before a purchased report can be recovered, a durable contract confirmation containing the product, price, terms version, consent record, delivery description, support contact, and immutable versioned Terms and Refund Policy text must be safely queued. Production checkout remains blocked until the aws-ses-sqs provider, verified sender, legal identity, and retention controls are verified.</p>
          <p>Conversion events are restricted to a fixed allowlist of event names. They do not include workflow content, filenames, report findings, credentials, email addresses, or customer-entered metadata.</p>
          <p>Never upload workflow exports containing plaintext secrets. Rotate any secret that appears directly in an exported workflow.</p>
        </div>
      </section>
    </main>
  );
}
