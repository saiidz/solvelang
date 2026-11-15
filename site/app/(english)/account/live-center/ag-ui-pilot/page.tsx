import type { Metadata } from "next";
import { AgUiPilotBoard } from "@/app/account/live-center/AgUiPilotBoard";

export const metadata: Metadata = {
  title: "Live Center — AG-UI Pilot",
  description:
    "A read-only pilot that renders the Live Center board from an AG-UI protocol event stream instead of the usual board response.",
  robots: { index: false, follow: false },
};

export default function AgUiPilotPage() {
  return <AgUiPilotBoard />;
}
