import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { extractReadableText } from "./extract.ts";
import { httpsGetPinned, HttpGetError, type HttpGet } from "./http.ts";
import { isBlockedIp, normalizeResearchUrl, researchAllowedHosts } from "./urlSafety.ts";
import { MAX_PAGE_BYTES, PAGE_FETCH_TIMEOUT_MS, ResearchError, type ResearchSource } from "./types.ts";

export type DnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: DnsLookup = (hostname) => lookup(hostname, { all: true });

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export interface FetchPageDeps {
  lookup?: DnsLookup;
  httpGet?: HttpGet;
  allowedHosts?: string[];
  now?: () => Date;
}

export async function retrievePublicPage(input: string, deps: FetchPageDeps = {}): Promise<ResearchSource> {
  const allowedHosts = deps.allowedHosts ?? researchAllowedHosts();
  const normalized = normalizeResearchUrl(input, allowedHosts);
  if (!normalized.ok) throw new ResearchError("INVALID_URL", normalized.error);

  const lookupFn = deps.lookup ?? defaultLookup;
  const httpGet = deps.httpGet ?? httpsGetPinned;
  const now = deps.now ?? (() => new Date());

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookupFn(normalized.host);
  } catch {
    throw new ResearchError("FETCH_FAILED", "The source host could not be resolved.");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new ResearchError("FETCH_FAILED", "The source host did not resolve to an address.");
  }
  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      throw new ResearchError("BLOCKED_DESTINATION", "The source host resolves to a non-public address.");
    }
  }

  const pinned = addresses[0];
  let response;
  try {
    response = await httpGet(normalized.url, {
      address: { address: pinned.address, family: pinned.family },
      timeoutMs: PAGE_FETCH_TIMEOUT_MS,
      maxBytes: MAX_PAGE_BYTES,
    });
  } catch (error) {
    if (error instanceof HttpGetError) {
      if (error.code === "TIMEOUT") throw new ResearchError("TIMEOUT", "The source took too long to respond.");
      if (error.code === "TOO_LARGE") throw new ResearchError("TOO_LARGE", "That source is larger than the allowed size.");
      if (error.code === "ENCODING") throw new ResearchError("UNSUPPORTED_TYPE", "That source encoding is not supported.");
      throw new ResearchError("FETCH_FAILED", "The source could not be retrieved.");
    }
    throw new ResearchError("FETCH_FAILED", "The source could not be retrieved.");
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ResearchError("REDIRECT_BLOCKED", "The source redirected; redirects are not followed.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ResearchError("FETCH_FAILED", `The source returned status ${response.status}.`);
  }

  const encoding = (response.contentEncoding ?? "").trim().toLowerCase();
  if (encoding !== "" && encoding !== "identity") {
    throw new ResearchError("UNSUPPORTED_TYPE", "That source encoding is not supported.");
  }

  const contentType = (response.contentType ?? "").toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.some((type) => contentType.includes(type))) {
    throw new ResearchError("UNSUPPORTED_TYPE", "That source type is not supported.");
  }

  const bytes = response.bytes;
  const html = new TextDecoder("utf-8").decode(bytes);

  const limitations: string[] = [];
  if (contentType.includes("text/plain")) limitations.push("Plain text source (no HTML structure).");

  const extracted = extractReadableText(html);
  if (extracted.truncated) limitations.push("Extracted text was truncated.");
  if (extracted.text.trim().length === 0) limitations.push("No readable text could be extracted.");

  return {
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    title: extracted.title || normalized.host,
    retrievedAt: now().toISOString(),
    httpStatus: response.status,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    extractedChars: extracted.text.length,
    text: extracted.text,
    limitations,
  };
}
