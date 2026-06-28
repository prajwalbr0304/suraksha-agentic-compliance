/**
 * GET  /api/documents — list all uploaded documents
 * DELETE /api/documents?id=xxx — delete a document and its storage file
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET ?? "compliance-documents";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("documents")
    .select("*")
    .order("uploaded_at", { ascending: false });
  query = query.eq("organization_id", principal.organizationId!);
  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function DELETE(req: NextRequest) {
  const principal = await requirePermission(req, "documents.delete");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = getSupabaseServerClient();

  // Fetch storage path first
  const { data: doc, error: fetchErr } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .single();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 404 });

  // Delete from storage
  if (doc?.storage_path) {
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  }

  // Delete obligations linked via document_id (org-scoped)
  await supabase.from("obligations").delete().eq("document_id", id).eq("organization_id", principal.organizationId!);

  // Delete the document row (org-scoped to prevent cross-tenant DELETE)
  const { error: delErr } = await supabase.from("documents").delete().eq("id", id).eq("organization_id", principal.organizationId!);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Audit
  await writeAudit(supabase, principal, {
    action: "document_processed",
    target: id,
    targetId: id,
    details: `Deleted document and associated data`,
    severity: "warning",
    metadata: { storage_path: doc.storage_path },
  });

  return NextResponse.json({ success: true });
}
