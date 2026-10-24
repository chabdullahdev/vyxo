import { NextResponse } from "next/server";
import { pickWindowsUrl } from "@/lib/site/download";
import { RELEASES_URL, REPO_URL } from "@/lib/site/links";

const LATEST_RELEASE_API = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/latest";

/**
 * Sends the visitor straight to the newest Windows installer. If GitHub cannot be
 * reached, or the newest release has no Windows build, fall back to the releases page.
 */
export async function GET() {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vyxo-website" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const url = pickWindowsUrl(await response.json());
      if (url) return NextResponse.redirect(url, 302);
    }
  } catch {
    // Fall through to the releases page.
  }
  return NextResponse.redirect(RELEASES_URL, 302);
}
