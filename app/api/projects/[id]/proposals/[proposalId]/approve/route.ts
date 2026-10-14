import type { NextRequest } from "next/server";
import { approveProposalResponse, methodNotAllowedResponse } from "@/lib/edits/api";
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

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id, proposalId } = await context.params;
  return approveProposalResponse(proposalStore, id, proposalId);
}

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["POST"]);
}
