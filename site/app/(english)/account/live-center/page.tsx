import type { Metadata } from "next";
import { LiveCenterBoard } from "@/app/account/live-center/LiveCenterBoard";

export const metadata: Metadata = {
  title: "Live Center",
  description: "Your SolveLang Process Solution merge queue, pull request checks, runners, and open actions in one place.",
  robots: { index: false, follow: false },
};

export default function LiveCenterPage() {
  return <LiveCenterBoard />;
}
