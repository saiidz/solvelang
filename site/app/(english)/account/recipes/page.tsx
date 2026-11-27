import type { Metadata } from "next";
import { RecipesBoard } from "@/app/account/recipes/RecipesBoard";

export const metadata: Metadata = {
  title: "Recipe catalog",
  description: "The SolveLang recipe catalog for your repositories: each recipe's configured and enabled state, shown as available only after it has been proven by a real run with a graded receipt.",
  robots: { index: false, follow: false },
};

export default function RecipesPage() {
  return <RecipesBoard />;
}
