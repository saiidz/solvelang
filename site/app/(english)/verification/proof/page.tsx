import type { Metadata } from "next";
import { ProofApp } from "../../../verification/proof/ProofApp";

export const metadata: Metadata = {
  title: "Verification, proven in public — SolveLang",
  description: "The public proof for SolveLang Verification: 13 real pull requests graded — 8 live by the deployed check on its proof repository, 5 through the receipt path and audited by hand — with catches, false blocks, and the unverified share published.",
  alternates: { canonical: "https://www.solve-lang.com/verification/proof/" },
};

export default function VerificationProofPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Verification — public proof</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Graded in the open, unverified share and all.</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Thirteen real pull requests, graded by the same machinery a customer installs. The catches are published, the false blocks are published, and so is the share of findings the evidence could not settle — because a verification tool that hides its own unverified share is asking for the trust it tells you not to give.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted"><span className="rounded-full border border-line bg-panel px-4 py-2">Live check runs</span><span className="rounded-full border border-line bg-panel px-4 py-2">Hand-audited receipts</span><span className="rounded-full border border-line bg-panel px-4 py-2">Every number traceable to a run record</span></div>
      </section>
      <ProofApp />
    </main>
  );
}
