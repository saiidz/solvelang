import type { Metadata } from "next";
import { alternatesForRoute } from "../../../i18n/seo";
import { DocsArticle } from "../DocsArticle";
import { guideBySlug } from "../docs-data";

const entry = guideBySlug("audit-a-repository");

export const metadata: Metadata = {
  title: entry.title,
  description: entry.summary,
  alternates: alternatesForRoute("docs/audit-a-repository"),
};

export default function Page() {
  return <DocsArticle entry={entry} />;
}
