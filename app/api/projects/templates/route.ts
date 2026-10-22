import type { NextRequest } from "next/server";
import { resolveProjectsDirectory } from "@/lib/storage/location";
import { jsonResponse, methodNotAllowed } from "@/lib/workspace/http";
import { listTemplates } from "@/lib/workspace/templates";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The starting points for a new workspace project, and where workspace projects are kept. */
export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return jsonResponse(
    {
      projectsFolder: resolveProjectsDirectory(),
      templates: listTemplates().map(({ id, label, tagline, suits, previewable }) => ({ id, label, tagline, suits, previewable })),
    },
    200,
  );
}

export function POST(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowed(["GET"]);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowed(["GET"]);
}

export function PATCH(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowed(["GET"]);
}

export function DELETE(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowed(["GET"]);
}
