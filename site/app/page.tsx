import type { Metadata } from "next";
import LandingPage from "./landing/page";
import { brandFacts } from "./brandFacts";

export const metadata: Metadata = {
  title: "SolveLang — Early-Beta Workflow Language and Studio",
  description: brandFacts.fullDescription,
  alternates: {
    canonical: "https://www.solve-lang.com/",
  },
};

export default function HomePage() {
  return <LandingPage />;
}
