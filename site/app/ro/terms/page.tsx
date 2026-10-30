import type { Metadata } from "next";
import { RomanianTerms } from "../../i18n/romanianLegal";

export const metadata: Metadata = {
  title: "Termeni de utilizare",
  description: "Termenii de utilizare SolveLang, operat de UPCOMINGSOUNDS S.R.L.",
};

export default function RomanianTermsPage() {
  return <RomanianTerms />;
}
