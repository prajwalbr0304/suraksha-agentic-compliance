import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET ?? "compliance-documents";

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, name, storage_path")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();

  if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 300); // 5-minute signed URL

  if (signError || !signedData?.signedUrl) {
    return NextResponse.json({ error: "Could not generate download link" }, { status: 500 });
  }

  return NextResponse.json({ signed_url: signedData.signedUrl, filename: doc.name, expires_in: 300 });
}
