import type { Metadata } from "next";
import { TeamContextBilling } from "@/app/account/team-context/TeamContextBilling";

export const metadata: Metadata = {
  title: "Team Context Index billing",
  description: "Seat billing for your teams on the hosted SolveLang MCP service: $8 per seat per month, counting active members only.",
  robots: { index: false, follow: false },
};

export default function TeamContextPage() {
  return <TeamContextBilling />;
}
