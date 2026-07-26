import type { Metadata } from "next";
import LandingPage from "./landing/page";
import { alternatesForRoute } from "../i18n/seo";

export const metadata: Metadata = {
  title: "SolveLang — See the System Before You Automate It",
  description:
    "SolveLang is a workflow analysis and automation language for support, intake, lead routing, approvals, and internal operations. Map decisions, exceptions, ownership, and human review before software runs the workflow.",
  alternates: alternatesForRoute(""),
};

export default function HomePage() {
  return <LandingPage />;
}
