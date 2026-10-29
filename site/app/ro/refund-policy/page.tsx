import type { Metadata } from "next";
import { RomanianRefundPolicy } from "../../i18n/romanianLegal";

export const metadata: Metadata = {
  title: "Politica de rambursare",
  description: "Politica de rambursare SolveLang, operat de UPCOMINGSOUNDS S.R.L.",
};

export default function RomanianRefundPolicyPage() {
  return <RomanianRefundPolicy />;
}
