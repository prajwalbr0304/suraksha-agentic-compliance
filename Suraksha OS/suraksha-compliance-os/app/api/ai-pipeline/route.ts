import { NextRequest, NextResponse } from "next/server";
import { aiPipelineService } from "@/lib/services/ai-pipeline.service";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();
  let reviewsQuery = supabase
    .from("extraction_reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);
  if (principal.organizationId) reviewsQuery = reviewsQuery.eq("organization_id", principal.organizationId);

  const { data: reviews } = await reviewsQuery;

  return NextResponse.json({
    capabilities: aiPipelineService.capabilities(),
    review_queue: reviews ?? [],
  });
}
