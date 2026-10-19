import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/web"], disallow: ["/api/", "/download"] },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
