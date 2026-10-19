export type PublicRouteDecision = "allow" | "home" | "block";

const ALLOWED_EXACT = new Set([
  "/web",
  "/download",
  "/web/terms",
  "/web/privacy",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/robots.txt",
  "/sitemap.xml",
]);

/**
 * A hosted copy of VYXO (VYXO_PUBLIC_SITE=1) exists only to show the website at
 * /web. The real app needs the visitor's own Ollama and local files, so every
 * app page and every API route is closed off there.
 */
export function decidePublicRoute(pathname: string): PublicRouteDecision {
  if (pathname === "/") return "home";
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (ALLOWED_EXACT.has(path)) return "allow";
  // Share images generated for the website, e.g. /web/opengraph-image.
  if (/^\/web\/(opengraph|twitter)-image(\.[a-z0-9]+)?$/.test(path)) return "allow";
  if (path.startsWith("/brand/")) return "allow";
  return "block";
}
