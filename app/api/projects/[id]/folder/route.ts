import type { NextRequest } from "next/server";
import {
  connectFolderResponse,
  disconnectFolderResponse,
  folderMethodNotAllowed,
  folderStatusResponse,
} from "@/lib/files/api";
import { projectFileService } from "@/lib/files/service";
import { projectStore } from "@/lib/projects/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return folderStatusResponse(projectStore, projectFileService, id);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return connectFolderResponse(projectStore, projectFileService, id, request);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return disconnectFolderResponse(projectStore, id);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return folderMethodNotAllowed(["GET", "POST", "DELETE"]);
}

export function PATCH(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return folderMethodNotAllowed(["GET", "POST", "DELETE"]);
}
