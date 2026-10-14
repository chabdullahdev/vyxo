import type { NextRequest } from "next/server";
import { listAgentsResponse, methodNotAllowedResponse } from "@/lib/agents/api";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return listAgentsResponse();
}

function methodNotAllowed(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET"]);
}

export function POST(request: NextRequest): Response {
  return methodNotAllowed(request);
}

export function PUT(request: NextRequest): Response {
  return methodNotAllowed(request);
}

export function PATCH(request: NextRequest): Response {
  return methodNotAllowed(request);
}

export function DELETE(request: NextRequest): Response {
  return methodNotAllowed(request);
}
