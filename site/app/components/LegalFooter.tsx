import Link from "next/link";
import legalContent from "../legal-content.json";

export function LegalFooter() {
  return <footer className="border-t border-slate-200 bg-white px-6 py-6 text-sm leading-7 text-slate-800">
    <nav aria-label="Policies and business contact" className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2">
      <Link href="/privacy-policy/">Privacy policy</Link><Link href="/cookie-policy/">Cookie policy</Link>
      <Link href="/terms/">Terms of use</Link><Link href="/refund-policy/">Refund policy</Link><Link href="/withdraw/">Withdrawal</Link>
      <a href={`mailto:${legalContent.supportEmail}`}>{legalContent.supportEmail}</a>
    </nav><p className="mx-auto mt-2 max-w-6xl">Operator: {legalContent.operator}.</p>
  </footer>;
}
