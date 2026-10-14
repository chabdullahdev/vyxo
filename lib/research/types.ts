export const MAX_RESEARCH_QUESTION_CHARS = 2_000;
export const MAX_RESEARCH_SOURCES = 6;
export const MAX_RESEARCH_URL_CHARS = 2_048;
export const MAX_PAGE_BYTES = 512 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;
export const MAX_RESEARCH_EVIDENCE_CHARS = 24_000;
export const MAX_RESEARCH_SYNTHESIS_CHARS = 16_000;
export const PAGE_FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 0;

export const DEFAULT_RESEARCH_ALLOWED_HOSTS = [
  "react.dev",
  "nextjs.org",
  "developer.mozilla.org",
  "nodejs.org",
  "docs.python.org",
  "docs.npmjs.com",
  "typescriptlang.org",
  "tailwindcss.com",
  "ollama.com",
] as const;

export interface ResearchSource {
  url: string;
  canonicalUrl: string;
  title: string;
  retrievedAt: string;
  httpStatus: number;
  contentHash: string;
  extractedChars: number;
  text: string;
  limitations: string[];
}

export interface ResearchCitationCheck {
  cited: number[];
  invalid: number[];
  verified: false;
}

export interface ResearchReport {
  question: string;
  sources: ResearchSource[];
  summary: string;
  citationCheck: ResearchCitationCheck;
  limitations: string[];
  providerStatus: "allowlist" | "unconfigured";
  createdAt: string;
}

export interface ResearchConfig {
  enabled: boolean;
  providerStatus: "allowlist" | "unconfigured";
  allowedHosts: string[];
  message: string;
}

export type ResearchErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_URL"
  | "BLOCKED_DESTINATION"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "REDIRECT_BLOCKED"
  | "LIMIT_EXCEEDED"
  | "MODEL_UNAVAILABLE"
  | "CANCELLED";

export class ResearchError extends Error {
  readonly code: ResearchErrorCode;

  constructor(code: ResearchErrorCode, message: string) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
  }
}
