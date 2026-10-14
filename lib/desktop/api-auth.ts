import { timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = "x-shipstudio-desktop-token";

export type DesktopAuthFailure =
  | "desktop-mode-disabled"
  | "desktop-auth-unconfigured"
  | "invalid-desktop-origin"
  | "request-protocol-mismatch"
  | "host-mismatch"
  | "origin-header-mismatch"
  | "token-missing"
  | "token-invalid";

export function getDesktopRequestAuthFailure(
  request: Request,
): DesktopAuthFailure | null {
  if (process.env.SHIPSTUDIO_DESKTOP !== "1") return "desktop-mode-disabled";

  const token = process.env.SHIPSTUDIO_DESKTOP_TOKEN;
  const expectedOrigin = process.env.SHIPSTUDIO_DESKTOP_ORIGIN;
  if (!token || !expectedOrigin) return "desktop-auth-unconfigured";

  let parsedOrigin: URL;
  let parsedRequest: URL;
  try {
    parsedOrigin = new URL(expectedOrigin);
    parsedRequest = new URL(request.url);
  } catch {
    return "invalid-desktop-origin";
  }

  if (parsedOrigin.protocol !== "http:" || parsedOrigin.hostname !== "127.0.0.1") {
    return "invalid-desktop-origin";
  }
  if (parsedRequest.protocol !== "http:") return "request-protocol-mismatch";
  if (request.headers.get("host") !== parsedOrigin.host) return "host-mismatch";

  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== parsedOrigin.origin) {
    return "origin-header-mismatch";
  }

  const suppliedToken = request.headers.get(TOKEN_HEADER);
  if (!suppliedToken) return "token-missing";

  const expectedBytes = Buffer.from(token, "utf8");
  const suppliedBytes = Buffer.from(suppliedToken, "utf8");
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return "token-invalid";
  }
  return null;
}

export function isAuthorizedDesktopRequest(request: Request): boolean {
  if (process.env.SHIPSTUDIO_DESKTOP !== "1") return true;
  return getDesktopRequestAuthFailure(request) === null;
}

export function unauthorizedDesktopResponse(request?: Request): Response {
  if (process.env.SHIPSTUDIO_DESKTOP_SMOKE === "1" && request) {
    console.error(`[desktop-auth] request rejected: ${getDesktopRequestAuthFailure(request) ?? "unknown"}`);
  }
  return Response.json(
    { error: "This request is not authorized for the desktop app." },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
