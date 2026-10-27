import type { Metadata } from "next";
import { RomanianWithdraw } from "../../i18n/romanianLegal";

export const metadata: Metadata = {
  title: "Retragerea din contract",
  description: "Retragerea din contractul SolveLang, operat de UPCOMINGSOUNDS S.R.L.",
};

export default function RomanianWithdrawPage() {
  return <RomanianWithdraw />;
}
