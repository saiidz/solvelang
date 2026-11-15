import type { Metadata } from "next";
import { alternatesForRoute } from "../../../i18n/seo";
import { SolutionArticle } from "../SolutionArticle";
import { solutionBySlug } from "../solutions-data";

const entry = solutionBySlug("labels-and-pools");

export const metadata: Metadata = {
  title: entry.title,
  description: entry.summary,
  alternates: alternatesForRoute("solutions/labels-and-pools"),
};

export default function Page() {
  return <SolutionArticle entry={entry} />;
}
