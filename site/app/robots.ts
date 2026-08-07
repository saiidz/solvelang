import type { MetadataRoute } from "next";

const privatePaths = [
  "/account/",
  "/api/",
  "/checkout/",
  "/success/",
];

const searchCrawlers = [
  "Googlebot",
  "bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
      ...searchCrawlers.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: privatePaths,
      })),
    ],
    sitemap: "https://www.solve-lang.com/sitemap.xml",
    host: "https://www.solve-lang.com",
  };
}
