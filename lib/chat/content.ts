export interface ContentSegment {
  type: "text" | "code";
  content: string;
  language: string | null;
}

const FENCE_PATTERN = /^\s*```/;
const CLOSING_FENCE_PATTERN = /^\s*```\s*$/;

export function splitFencedCode(text: string): ContentSegment[] {
  if (typeof text !== "string" || text.length === 0) {
    return [{ type: "text", content: "", language: null }];
  }

  const lines = text.split("\n");
  const segments: ContentSegment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let language: string | null = null;

  const flushText = () => {
    if (buffer.length > 0) {
      segments.push({ type: "text", content: buffer.join("\n"), language: null });
      buffer = [];
    }
  };

  for (const line of lines) {
    if (!inCode && FENCE_PATTERN.test(line)) {
      flushText();
      inCode = true;
      language = line.trim().slice(3).trim() || null;
      continue;
    }
    if (inCode && CLOSING_FENCE_PATTERN.test(line)) {
      segments.push({ type: "code", content: buffer.join("\n"), language });
      buffer = [];
      inCode = false;
      language = null;
      continue;
    }
    buffer.push(line);
  }

  if (inCode) {
    segments.push({ type: "code", content: buffer.join("\n"), language });
  } else {
    flushText();
  }

  if (segments.length === 0) {
    return [{ type: "text", content: "", language: null }];
  }
  return segments;
}
