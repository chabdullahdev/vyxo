import type { NextRequest } from "next/server";
import { methodNotAllowedResponse, runPlanResponse } from "@/lib/agents/api";
import { createTaskRunner } from "@/lib/agents/runner";
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
  return runPlanResponse({ store: planStore, runner: createTaskRunner() }, planId, request.signal);
}

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["POST"]);
}
