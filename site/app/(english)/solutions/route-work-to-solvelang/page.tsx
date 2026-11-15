import type { Metadata } from "next";
import { alternatesForRoute } from "../../../i18n/seo";
import { SolutionArticle } from "../SolutionArticle";
import { solutionBySlug } from "../solutions-data";

const entry = solutionBySlug("route-work-to-solvelang");

export const metadata: Metadata = {
  title: entry.title,
  description: entry.summary,
  alternates: alternatesForRoute("solutions/route-work-to-solvelang"),
};

export default function Page() {
  return <SolutionArticle entry={entry} />;
}
