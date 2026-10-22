import type { NextRequest } from "next/server";
import {
  deleteProjectResponse,
  getProjectResponse,
  methodNotAllowedResponse,
  updateProjectResponse,
} from "@/lib/projects/api";
import { projectStore } from "@/lib/projects/store";
import { conversationStore } from "@/lib/conversations/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return getProjectResponse(projectStore, id);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return updateProjectResponse(projectStore, id, request);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  const deleteFiles = new URL(request.url).searchParams.get("deleteFiles") === "true";
  return deleteProjectResponse(projectStore, conversationStore, id, { deleteFiles });
}

export function POST(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}
