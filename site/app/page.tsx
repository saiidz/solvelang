import type { Metadata } from "next";
import LandingPage from "./landing/page";

export const metadata: Metadata = {
  title: "SolveLang — Workflow X-Ray for Founder-Led Operations",
  description:
    "SolveLang turns messy support, intake, lead routing, and internal ops workflows into readable automation blueprints, human review points, and SolveLang-style workflow drafts.",
};

export default function HomePage() {
  return <LandingPage />;
}
