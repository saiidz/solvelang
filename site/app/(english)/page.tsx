import type { Metadata } from "next";
import LandingPage from "./landing/page";
import { alternatesForRoute } from "../i18n/seo";

const homeTitle =
  "SolveLang — Workflow Language, API Access & Merge Governance";
const homeDescription =
  "Open-source workflow language with API access plans, plus Process Solution: merge governance that batches, verifies & lands pull requests faster.";

export const metadata: Metadata = {
  title: {
    absolute: homeTitle,
  },
  description: homeDescription,
  alternates: alternatesForRoute(""),
  openGraph: { title: homeTitle, description: homeDescription },
  twitter: { title: homeTitle, description: homeDescription },
};

export default function HomePage() {
  return <LandingPage />;
}
