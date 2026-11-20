import type { Metadata } from "next";
import { alternatesForRoute } from "../../../i18n/seo";
import { DocsArticle } from "../DocsArticle";
import { guideBySlug } from "../docs-data";

const entry = guideBySlug("runner-minutes");

export const metadata: Metadata = {
  title: entry.title,
  description: entry.summary,
  alternates: alternatesForRoute("docs/runner-minutes"),
};

export default function Page() {
  return <DocsArticle entry={entry} />;
}
