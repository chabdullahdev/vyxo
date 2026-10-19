export type PublicRouteDecision = "allow" | "home" | "block";

/**
 * A hosted copy of VYXO (VYXO_PUBLIC_SITE=1) exists only to show the About page.
 * The real app needs the visitor's own Ollama and local files, so every app
 * page and every API route is closed off there.
 */
export function decidePublicRoute(pathname: string): PublicRouteDecision {
  if (pathname === "/") return "home";
  if (pathname === "/about" || pathname === "/about/") return "allow";
  if (pathname.startsWith("/brand/") || pathname === "/favicon.ico") return "allow";
  return "block";
}
