import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number) => ({
    url: new URL(path, siteUrl()).toString(),
    changeFrequency: "monthly" as const,
    priority,
  });
  return [page("/web", 1), page("/web/privacy", 0.3), page("/web/terms", 0.3)];
}
