import type { NextRequest } from "next/server";
import {
  createProjectResponse,
  listProjectsResponse,
  methodNotAllowedResponse,
} from "@/lib/projects/api";
import { projectStore } from "@/lib/projects/store";
import { conversationStore } from "@/lib/conversations/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return listProjectsResponse(projectStore, conversationStore, request);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return createProjectResponse(projectStore, request);
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
