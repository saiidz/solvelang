import type { Metadata } from "next";
import LandingPage from "./landing/page";
import { alternatesForRoute } from "../i18n/seo";

export const metadata: Metadata = {
  title: {
    absolute:
      "SolveLang — Readable, Explainable Workflows for AI-Assisted Business Processes",
  },
  description:
    "SolveLang is an early-beta, open-source workflow language for making deterministic rules, AI-assisted decisions, approvals, tools, and failure paths readable and reviewable before managed automation.",
  alternates: alternatesForRoute(""),
};

export default function HomePage() {
  return <LandingPage />;
}
