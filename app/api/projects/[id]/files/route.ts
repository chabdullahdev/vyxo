import type { NextRequest } from "next/server";
import { folderMethodNotAllowed, listFilesResponse } from "@/lib/files/api";
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
  return listFilesResponse(projectStore, projectFileService, id, request);
}

export function POST(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return folderMethodNotAllowed(["GET"]);
}
