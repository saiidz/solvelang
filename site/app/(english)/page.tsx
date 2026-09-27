import type { Metadata } from "next";
import LandingPage from "./landing/page";
import { alternatesForRoute } from "../i18n/seo";

export const metadata: Metadata = {
  title: {
    absolute:
      "SolveLang — Workflow Intelligence With Explicit Boundaries",
  },
  description:
    "Model workflows, inspect repository evidence, and run a browser-safe SolveLang preview. See what is repository-tested, deployed, and verified live before automating.",
  alternates: alternatesForRoute(""),
};

export default function HomePage() {
  return <LandingPage />;
}
