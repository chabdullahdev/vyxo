import type { NextRequest } from "next/server";
import { getSettingsResponse, updateSettingsResponse } from "@/lib/settings/api";
import { settingsStore } from "@/lib/settings/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return getSettingsResponse(settingsStore);
}

export async function PATCH(request: NextRequest): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return updateSettingsResponse(settingsStore, request);
}

function methodNotAllowed(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "GET, PATCH", "Cache-Control": "no-store" } },
  );
}

export function POST(request: NextRequest): Response {
  return methodNotAllowed(request);
}

export function PUT(request: NextRequest): Response {
  return methodNotAllowed(request);
}

export function DELETE(request: NextRequest): Response {
  return methodNotAllowed(request);
}
