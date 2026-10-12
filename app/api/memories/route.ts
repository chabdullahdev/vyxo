import type { NextRequest } from "next/server";
import {
  createMemoryResponse,
  listMemoriesResponse,
  methodNotAllowedResponse,
} from "@/lib/memory/api";
import { memoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return listMemoriesResponse(memoryStore);
}

export async function POST(request: NextRequest): Promise<Response> {
  return createMemoryResponse(memoryStore, request);
}

export function PUT(): Response {
  return methodNotAllowedResponse(["GET", "POST"]);
}

export function PATCH(): Response {
  return methodNotAllowedResponse(["GET", "POST"]);
}

export function DELETE(): Response {
  return methodNotAllowedResponse(["GET", "POST"]);
}
