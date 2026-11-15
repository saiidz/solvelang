import type { Metadata } from "next";
import { alternatesForRoute } from "../../../i18n/seo";
import { SolutionArticle } from "../SolutionArticle";
import { solutionBySlug } from "../solutions-data";

const entry = solutionBySlug("repository-added-after-install");

export const metadata: Metadata = {
  title: entry.title,
  description: entry.summary,
  alternates: alternatesForRoute("solutions/repository-added-after-install"),
};

export default function Page() {
  return <SolutionArticle entry={entry} />;
}
