import type { NextRequest } from "next/server";
import { getPlanResponse, methodNotAllowedResponse } from "@/lib/agents/api";
import { planStore } from "@/lib/agents/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { planId } = await context.params;
  return getPlanResponse(planStore, planId);
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
