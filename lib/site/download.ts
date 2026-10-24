import { REPO_URL } from "./links.ts";

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

/**
 * Pick the first asset whose name matches from a GitHub release. Only a file hosted
 * under this project's own release downloads is accepted, so a bad response can never
 * turn the Download button into a redirect to somewhere else.
 */
function pickAssetUrl(release: unknown, pattern: RegExp): string | null {
  if (typeof release !== "object" || release === null) return null;
  const { assets, draft, prerelease } = release as { assets?: unknown; draft?: unknown; prerelease?: unknown };
  if (draft === true || prerelease === true || !Array.isArray(assets)) return null;

  const prefix = `${REPO_URL}/releases/download/`;
  for (const asset of assets as ReleaseAsset[]) {
    const { name, browser_download_url: url } = asset ?? {};
    if (typeof name !== "string" || typeof url !== "string") continue;
    if (!pattern.test(name)) continue;
    if (!url.startsWith(prefix) || !url.endsWith(`/${name}`) || /[\s?#]/.test(url)) continue;
    return url;
  }
  return null;
}

/** The Apple Silicon dmg. */
export function pickDmgUrl(release: unknown): string | null {
  return pickAssetUrl(release, /-arm64\.dmg$/);
}

/** The 64-bit Windows installer. */
export function pickWindowsUrl(release: unknown): string | null {
  return pickAssetUrl(release, /-x64\.exe$/);
}
