import type { Metadata } from "next";
import SolveGraphExplorerApp from "../../solve-graph/SolveGraphExplorerApp";

export const metadata: Metadata = {
  title: "Solve Graph Local Explorer",
  description: "Explore integrity-verified SolveLang repository graphs locally in your browser without executing repository code.",
  robots: { index: false, follow: false },
};

export default function SolveGraphPage() {
  return <SolveGraphExplorerApp />;
}
