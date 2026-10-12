import type { NextRequest } from "next/server";
import {
  deleteMemoryResponse,
  getMemoryResponse,
  methodNotAllowedResponse,
  updateMemoryResponse,
} from "@/lib/memory/api";
import { memoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return getMemoryResponse(memoryStore, id);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return updateMemoryResponse(memoryStore, id, request);
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return deleteMemoryResponse(memoryStore, id);
}

export function POST(): Response {
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}

export function PUT(): Response {
  return methodNotAllowedResponse(["GET", "PATCH", "DELETE"]);
}
