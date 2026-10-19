import { REPO_URL, SITE_URL } from "./links.ts";

/**
 * Absolute base URL used for share images, the sitemap, and canonical links.
 * Set NEXT_PUBLIC_SITE_URL for a custom domain; Vercel's production domain is
 * used otherwise, and the public site address when neither is set.
 */
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // Fall through to the defaults.
    }
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL(SITE_URL);
}

export { REPO_URL };
