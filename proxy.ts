import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createDesktopContentSecurityPolicy } from "@/lib/desktop/csp";
import { decidePublicRoute } from "@/lib/site/publicMode";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.VYXO_PUBLIC_SITE === "1") {
    const decision = decidePublicRoute(pathname);
    if (decision === "home") {
      return NextResponse.rewrite(new URL("/about", request.url));
    }
    if (decision === "block") {
      return new NextResponse("Not found", { status: 404 });
    }
    return NextResponse.next();
  }

  if (
    process.env.SHIPSTUDIO_DESKTOP !== "1" ||
    process.env.NODE_ENV !== "production" ||
    pathname.startsWith("/api")
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
