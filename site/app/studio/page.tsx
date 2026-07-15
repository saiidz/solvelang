import type { Metadata } from "next";
import StudioApp from "./StudioApp";

export const metadata: Metadata = {
  title: "Workflow Intelligence Studio — SolveLang",
  description: "Model, analyze, simulate, and export business workflows locally in your browser with deterministic SolveLang workflow intelligence.",
};

export default function StudioPage() {
  return <StudioApp />;
}
