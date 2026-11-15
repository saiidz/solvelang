import type { Metadata } from "next";
import RunnerMinutesAdmin from "@/app/account/runner-minutes-admin/RunnerMinutesAdmin";

export const metadata: Metadata = {
  title: "Runner minutes admin",
  description: "Owner controls for SolveLang runner minutes: every account's balance and status, add or take minutes, pause or resume an account.",
  robots: { index: false, follow: false },
};

export default function RunnerMinutesAdminPage() {
  return <RunnerMinutesAdmin />;
}
