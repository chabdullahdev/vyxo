import type { NextRequest } from "next/server";
import {
  getProposalResponse,
  methodNotAllowedResponse,
  rejectProposalResponse,
} from "@/lib/edits/api";
import { proposalStore } from "@/lib/edits/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; proposalId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id, proposalId } = await context.params;
  return getProposalResponse(proposalStore, id, proposalId);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id, proposalId } = await context.params;
  return rejectProposalResponse(proposalStore, id, proposalId);
}

export function POST(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "DELETE"]);
}

export function PUT(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "DELETE"]);
}

export function PATCH(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["GET", "DELETE"]);
}
