import { DEFAULT_RESEARCH_ALLOWED_HOSTS, MAX_RESEARCH_URL_CHARS } from "./types.ts";

export type ResearchUrlResult =
  | { ok: true; url: string; canonicalUrl: string; host: string }
  | { ok: false; error: string };

export function researchAllowedHosts(): string[] {
  const extra = (process.env.RESEARCH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_RESEARCH_ALLOWED_HOSTS, ...extra])];
}

export function hostMatchesAllowlist(host: string, allowedHosts: readonly string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

export function isBlockedIpv4(value: string): boolean | null {
  const octets = parseIpv4(value);
  if (!octets) return null;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function expandIpv6(value: string): number[] | null {
  let text = value.toLowerCase();
  if (text.includes(".")) {
    const v4 = parseIpv4(text.slice(text.lastIndexOf(":") + 1));
    if (!v4) return null;
    const hex = ((v4[0] << 8) | v4[1]).toString(16);
    const hex2 = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${hex}:${hex2}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (segment: string): number[] | null => {
    if (segment.length === 0) return [];
    const groups = segment.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = parseGroups(halves[1]);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array(missing).fill(0), ...tail];
}

export function isBlockedIpv6(value: string): boolean | null {
  if (!value.includes(":")) return null;
  const groups = expandIpv6(value);
  if (!groups) return null;

  const allZero = groups.every((group) => group === 0);
  if (allZero) return true;

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && groups[1] === 0x0db8) return true;

  const allButLastZero = groups.slice(0, 7).every((group) => group === 0);
  if (allButLastZero && groups[7] === 1) return true;

  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIpv4(embedded) ?? true;
  }

  return false;
}

export function isBlockedIp(value: string): boolean {
  const v4 = isBlockedIpv4(value);
  if (v4 !== null) return v4;
  const v6 = isBlockedIpv6(value);
  if (v6 !== null) return v6;
  return true;
}

function looksLikeIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true;
  return parseIpv4(host) !== null;
}

export function normalizeResearchUrl(
  input: unknown,
  allowedHosts: readonly string[] = researchAllowedHosts(),
): ResearchUrlResult {
  if (typeof input !== "string") return { ok: false, error: "A source URL must be text." };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "A source URL is required." };
  if (trimmed.length > MAX_RESEARCH_URL_CHARS) return { ok: false, error: "That URL is too long." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Only https:// sources are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs must not contain credentials." };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, error: "Only the default https port is allowed." };
  }

  const host = url.hostname.toLowerCase();
  if (looksLikeIpLiteral(host)) {
    return { ok: false, error: "IP-address sources are not allowed." };
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, error: "Local and internal hosts are not allowed." };
  }
  if (!hostMatchesAllowlist(host, allowedHosts)) {
    return { ok: false, error: "That host is not on the approved documentation allowlist." };
  }

  url.hash = "";
  return { ok: true, url: url.toString(), canonicalUrl: url.toString(), host };
}
