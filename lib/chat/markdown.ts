import { splitFencedCode } from "./content.ts";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "rule" }
  | { type: "code"; language: string | null; content: string };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UNORDERED = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** Only plain web and mail links are rendered as links; everything else stays text. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value) && !/\s/.test(value)) return value;
  return null;
}

function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  let index = 0;

  const flush = () => {
    if (text) nodes.push({ type: "text", text });
    text = "";
  };

  while (index < source.length) {
    const rest = source.slice(index);

    if (rest.startsWith("`")) {
      const end = source.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ type: "code", text: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      nodes.push({ type: "strong", children: parseInline(strong[2]) });
      index += strong[0].length;
      continue;
    }

    const em = /^(\*|_)(?=\S)([^*_]*?\S)\1(?![A-Za-z0-9])/.exec(rest);
    if (em && (rest[0] === "*" || index === 0 || /\W/.test(source[index - 1]))) {
      flush();
      nodes.push({ type: "em", children: parseInline(em[2]) });
      index += em[0].length;
      continue;
    }

    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]);
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: parseInline(link[1]) });
        index += link[0].length;
        continue;
      }
    }

    const bare = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest);
    if (bare && (index === 0 || /[\s(]/.test(source[index - 1]))) {
      flush();
      nodes.push({ type: "link", href: bare[0], children: [{ type: "text", text: bare[0] }] });
      index += bare[0].length;
      continue;
    }

    text += source[index];
    index += 1;
  }

  flush();
  return nodes;
}

function parseTextBlocks(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4,
        children: parseInline(heading[2]),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const quoted = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        i += 1;
        quoted.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
      }
      blocks.push({ type: "quote", children: parseInline(quoted.join("\n")) });
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const pattern = isOrdered ? ORDERED : UNORDERED;
      const start = ordered ? Number(ordered[1]) : 1;
      const items: InlineNode[][] = [];
      let current = (unordered ?? (ordered as RegExpExecArray))[isOrdered ? 2 : 1];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextMatch = pattern.exec(next);
        if (nextMatch) {
          items.push(parseInline(current));
          current = nextMatch[isOrdered ? 2 : 1];
          i += 1;
        } else if (/^\s{2,}\S/.test(next) && !UNORDERED.test(next) && !ORDERED.test(next)) {
          current += `\n${next.trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      items.push(parseInline(current));
      blocks.push({ type: "list", ordered: isOrdered, start, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Turn assistant text into a small block tree. The tree is rendered with React
 * elements only, so model output can never inject HTML or scripts.
 */
export function parseMarkdown(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (const segment of splitFencedCode(text)) {
    if (segment.type === "code") {
      blocks.push({ type: "code", language: segment.language, content: segment.content });
    } else {
      blocks.push(...parseTextBlocks(segment.content));
    }
  }
  return blocks;
}
