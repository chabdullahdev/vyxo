import type { NextRequest } from "next/server";
import {
  methodNotAllowedResponse,
  researchConfigResponse,
  runResearchResponse,
} from "@/lib/research/api";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return researchConfigResponse();
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return runResearchResponse(request);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "POST"]);
}

export function PATCH(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "POST"]);
}

export function DELETE(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "POST"]);
}
