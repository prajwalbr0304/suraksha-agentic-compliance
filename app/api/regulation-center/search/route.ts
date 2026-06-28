import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { embeddingToVectorLiteral, hashingEmbedding384 } from "@/lib/regulation-embedding";

export const runtime = "nodejs";

/**
 * POST { "q": "search text", "matchCount": 10 } — semantic-ish search over regulation-linked chunks.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  let body: { q?: string; matchCount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const q = String(body.q || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const matchCount = Math.min(50, Math.max(1, Number(body.matchCount) || 15));
  const vec = hashingEmbedding384(q);
  const literal = embeddingToVectorLiteral(vec);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("match_regulation_chunks", {
    query_embedding: literal,
    p_organization_id: principal.organizationId!,
    match_count: matchCount,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data ?? [] });
}
