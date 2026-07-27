import Link from "next/link";
import type { PublicRouteSegment } from "./routes";

const reviewNotice = "Aceasta traducere automata necesita verificare juridica si a proprietarului inainte de activarea platii in productie.";

function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <main lang="ro" dir="ltr" className="min-h-screen bg-slate-50 px-6 py-14 text-slate-950 sm:py-20">
      <article className="mx-auto max-w-3xl space-y-7 leading-7 text-slate-700">{children}</article>
    </main>
  );
}

export function RomanianLegalDraft({ route }: { route: PublicRouteSegment }) {
  if (route === "terms") {
    return <LegalShell><nav className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/ro/refund-policy/">Politica de rambursare</Link><Link href="/ro/preflight-privacy/">Confidentialitate</Link><Link href="/ro/withdraw/">Retragere</Link></nav><h1 className="text-4xl font-semibold text-slate-950">Termeni de utilizare SolveLang</h1><p>Versiunea 2026-07-26-v2. SolveLang este operat de UPCOMINGSOUNDS S.R.L., Romania. Identitatea juridica completa, sediul, telefonul, registrul comertului, CUI, TVA si pretul final pentru consumatori necesita verificarea proprietarului inainte de activarea platii in productie.</p><h2 className="text-2xl font-semibold text-slate-950">Serviciu digital si drepturi obligatorii</h2><p>Workflow Preflight livreaza imediat un raport digital automatizat. Pentru continut digital sau servicii se aplica regulile legale corespunzatoare privind retragerea, consimtamantul expres, confirmarea pe suport durabil si executarea integrala. Drepturile obligatorii ale consumatorilor, inclusiv remedii pentru neexecutare, neconformitate, plati neautorizate si plati duble, nu sunt afectate.</p><h2 className="text-2xl font-semibold text-slate-950">Raspundere</h2><p>Nimic din acesti termeni nu limiteaza raspunderea pentru frauda, conduita intentionata, culpa grava, vatamare corporala sau orice raspundere care nu poate fi limitata legal. Orice limita aplicabila utilizatorilor comerciali se aplica numai in masura maxima permisa de lege.</p><p className="text-sm">{reviewNotice}</p></LegalShell>;
  }
  if (route === "refund-policy") {
    return <LegalShell><nav className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/ro/terms/">Termeni</Link><Link href="/ro/withdraw/">Retragere</Link></nav><h1 className="text-4xl font-semibold text-slate-950">Politica de rambursare</h1><p>Versiunea 2026-07-26-v2. Raportul Workflow Preflight este un produs digital automatizat cu livrare imediata. Regimul retragerii depinde de incadrarea juridica aplicabila continutului digital sau serviciilor si de conditiile legale pentru consimtamant, recunoastere si confirmare pe suport durabil.</p><h2 className="text-2xl font-semibold text-slate-950">Remedii obligatorii</h2><p>Politica comerciala nu exclude remedii obligatorii pentru neexecutare, neconformitate, plati neautorizate, plati duble sau alte drepturi prevazute de lege.</p><h2 className="text-2xl font-semibold text-slate-950">Solicitari</h2><p>Puteti trimite o solicitare la <Link className="font-semibold text-blue-700 underline" href="/ro/withdraw/">formularul de retragere</Link>. Formularul nu decide automat eligibilitatea si nu promite rambursarea.</p><p className="text-sm">{reviewNotice}</p></LegalShell>;
  }
  if (route === "preflight-privacy") {
    return <LegalShell><nav className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/ro/terms/">Termeni</Link><Link href="/ro/refund-policy/">Rambursari</Link></nav><h1 className="text-4xl font-semibold text-slate-950">Confidentialitate Workflow Preflight</h1><p>Scanarea initiala ruleaza in browser. La plata, API-ul primeste un identificator opac, emailul validat pentru confirmare si chitanta Stripe, versiunea termenilor si consimtamantul necesar. Emailul nu este stocat in DynamoDB si nu este inclus in metadatele PaymentIntent.</p><p>Metadatele PaymentIntent contin doar identificatorul opac, produsul, versiunea termenilor, momentul de acceptare derivat de server si confirmarile necesare. Numele workflow-ului, parametrii nodurilor, acreditari, continutul raportului, tokenul Turnstile, IP-ul si agentul utilizatorului nu sunt incluse.</p><p className="text-sm">{reviewNotice}</p></LegalShell>;
  }
  if (route === "withdraw") {
    return <LegalShell><nav className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/withdraw/">English withdrawal form</Link><Link href="/ro/terms/">Termeni</Link></nav><h1 className="text-4xl font-semibold text-slate-950">Cerere de retragere</h1><p>Puteti transmite declaratia de retragere prin formularul in limba engleza sau la hello@solve-lang.com. Nu includeti numere de card, continutul workflow-ului, acreditari sau secrete. Cererea este confirmata pe suport durabil numai dupa configurarea furnizorului aws-ses-sqs; nu reprezinta o decizie automata privind eligibilitatea sau o promisiune de rambursare.</p><p className="text-sm">{reviewNotice}</p></LegalShell>;
  }
  return null;
}
