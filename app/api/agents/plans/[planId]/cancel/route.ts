import type { NextRequest } from "next/server";
import { cancelPlanResponse, methodNotAllowedResponse } from "@/lib/agents/api";
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

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { planId } = await context.params;
  return cancelPlanResponse(planStore, planId, new Date().toISOString());
}

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["POST"]);
}
