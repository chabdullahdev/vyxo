import { researchConfig, runResearch, type RunResearchDeps } from "./run.ts";
import { ResearchError } from "./types.ts";

const MAX_BODY_BYTES = 32_000;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function researchErrorResponse(error: unknown): Response {
  if (error instanceof ResearchError) {
    const statusByCode: Partial<Record<ResearchError["code"], number>> = {
      INVALID_REQUEST: 400,
      INVALID_URL: 400,
      REDIRECT_BLOCKED: 400,
      BLOCKED_DESTINATION: 403,
      TOO_LARGE: 413,
      LIMIT_EXCEEDED: 413,
      UNSUPPORTED_TYPE: 415,
      FETCH_FAILED: 502,
      TIMEOUT: 504,
      MODEL_UNAVAILABLE: 503,
      CANCELLED: 409,
    };
    return jsonResponse({ error: error.message }, statusByCode[error.code] ?? 400);
  }
  console.error("[research] request failed");
  return jsonResponse({ error: "The research request could not be completed." }, 500);
}

export function researchConfigResponse(): Response {
  return jsonResponse(researchConfig(), 200);
}

export async function runResearchResponse(
  request: Request,
  deps: RunResearchDeps = {},
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse({ error: "Could not read the request body." }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large." }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return jsonResponse({ error: "Request body must be a JSON object." }, 400);
  }

  const body = parsed as { question?: unknown; urls?: unknown };
  const urls = Array.isArray(body.urls) ? body.urls.filter((url): url is string => typeof url === "string") : [];

  try {
    const report = await runResearch(
      { question: typeof body.question === "string" ? body.question : "", urls },
      { ...deps, signal: request.signal },
    );
    return jsonResponse({ report }, 200);
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export function methodNotAllowedResponse(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}
