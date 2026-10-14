import type { NextRequest } from "next/server";
import {
  deleteMemoryResponse,
  getMemoryResponse,
  methodNotAllowedResponse,
  updateMemoryResponse,
} from "@/lib/memory/api";
import { memoryStore } from "@/lib/memory/store";
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
  return getMemoryResponse(memoryStore, id);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return updateMemoryResponse(memoryStore, id, request);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;
  return deleteMemoryResponse(memoryStore, id);
}

export function POST(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}
