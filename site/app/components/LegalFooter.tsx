import Link from "next/link";
import legalContent from "../legal-content.json";

export function LegalFooter() {
  return <footer className="border-t border-white/10 bg-[#0a0e1a] px-6 py-4 text-sm leading-6 text-slate-300 sm:py-6 sm:leading-7">
    <nav aria-label="Policies and business contact" className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 sm:gap-x-5 sm:gap-y-2">
      <Link href="/privacy-policy/">Privacy policy</Link><Link href="/cookie-policy/">Cookie policy</Link>
      <Link href="/terms/">Terms of use</Link><Link href="/refund-policy/">Refund policy</Link><Link href="/data-processing/">Data processing</Link><Link href="/subprocessors/">Subprocessors</Link><Link href="/acceptable-use/">Acceptable use</Link><Link href="/withdraw/">Withdrawal</Link>
      <a href={`mailto:${legalContent.supportEmail}`}>{legalContent.supportEmail}</a>
    </nav><p className="mx-auto mt-2 max-w-6xl text-slate-400">Operator: {legalContent.operator}.</p>
  </footer>;
}
