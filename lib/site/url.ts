import { REPO_URL } from "./links.ts";

/**
 * Absolute base URL used for share images, the sitemap, and canonical links.
 * Set NEXT_PUBLIC_SITE_URL for a custom domain; Vercel's production domain is
 * used otherwise, and localhost when running the app on your own machine.
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
  return new URL("http://localhost:3697");
}

export { REPO_URL };
