import type { NextRequest } from "next/server";
import { methodNotAllowedResponse, recoverProposalResponse, recoveryListResponse } from "@/lib/edits/api";
import { proposalStore, recoveryStore } from "@/lib/edits/store";
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
  return recoveryListResponse(recoveryStore, id);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const proposalId =
    typeof body === "object" && body !== null && typeof (body as { proposalId?: unknown }).proposalId === "string"
      ? (body as { proposalId: string }).proposalId
      : "";
  if (!proposalId) {
    return Response.json({ error: "`proposalId` is required." }, { status: 400 });
  }

  return recoverProposalResponse(
    { service: projectFileService, proposalStore, recoveryStore, projectStore },
    id,
    proposalId,
  );
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
