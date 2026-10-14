import type { NextRequest } from "next/server";
import { applyProposalResponse, methodNotAllowedResponse } from "@/lib/edits/api";
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
  params: Promise<{ id: string; proposalId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  const { id, proposalId } = await context.params;
  return applyProposalResponse(
    { service: projectFileService, proposalStore, recoveryStore, projectStore },
    id,
    proposalId,
  );
}

export function GET(request: NextRequest): Response {
  if (!isAuthorizedDesktopRequest(request)) return unauthorizedDesktopResponse(request);
  return methodNotAllowedResponse(["POST"]);
}
