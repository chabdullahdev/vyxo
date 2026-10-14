import { MAX_EXTRACTED_TEXT_CHARS } from "./types.ts";

const DROPPED_TAGS = ["script", "style", "noscript", "template", "svg", "head", "iframe", "canvas"];

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return collapse(htmlToText(match[1])).slice(0, 300);
}

function collapse(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToText(html: string): string {
  let text = html;
  for (const tag of DROPPED_TAGS) {
    text = text.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/(h[1-6]|p|div|section|article|tr|blockquote|pre|ul|ol)>/gi, "\n");
  text = text.replace(/<(h[1-6])[^>]*>/gi, "\n");
  text = text.replace(/<pre[^>]*>/gi, "\n```\n").replace(/<\/pre>/gi, "\n```\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return collapse(text);
}

export interface ExtractedPage {
  title: string;
  text: string;
  truncated: boolean;
}

export function extractReadableText(html: string): ExtractedPage {
  const title = extractTitle(html);
  const full = htmlToText(html);
  const truncated = full.length > MAX_EXTRACTED_TEXT_CHARS;
  return {
    title,
    text: truncated ? full.slice(0, MAX_EXTRACTED_TEXT_CHARS) : full,
    truncated,
  };
}
