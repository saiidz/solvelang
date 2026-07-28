import type { MetadataRoute } from "next";
import { sitemapEntries } from "./i18n/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
