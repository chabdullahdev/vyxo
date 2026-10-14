import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createDesktopContentSecurityPolicy } from "@/lib/desktop/csp";

export function proxy(request: NextRequest) {
  if (
    process.env.SHIPSTUDIO_DESKTOP !== "1" ||
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }

  const nonce = Buffer.from(randomUUID()).toString("base64");
  const policy = createDesktopContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
