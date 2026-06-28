import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessRow, isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

// GET — evidence with obligation details for the evidence intelligence view
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  const { searchParams } = new URL(req.url);
  const department = searchParams.get("department");
  const status = searchParams.get("status"); // "collected" | "pending"

  const supabase = getSupabaseServerClient();

  let query = supabase
    .from("evidence")
    .select(`
      id, title, description, collected_at, created_at,
      obligation_id,
      obligations!inner(id, title, department, priority, status, regulation)
    `)
    .order("created_at", { ascending: false });
  if (principal.organizationId) {
    query = query.eq("organization_id", principal.organizationId);
  }

  if (department && department !== "all") {
    query = query.eq("obligations.department", department);
  }
  if (status === "collected") {
    query = query.not("collected_at", "is", null);
  } else if (status === "pending") {
    query = query.is("collected_at", null);
  }

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json([], { status: 500 });
  const visible = (data ?? []).filter((row: Record<string, unknown>) => {
    const obligation = row.obligations as Record<string, unknown> | undefined;
    return obligation ? canAccessRow(principal, obligation) : true;
  });
  return NextResponse.json(visible);
}

// POST — AI-recommend evidence for a given obligation text
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "evidence.create");
  if (isAuthResponse(principal)) return principal;

  try {
    const { obligation_id, obligation_title, department, regulation } = await req.json();
    if (!obligation_id) return NextResponse.json({ error: "obligation_id required" }, { status: 400 });

    // Evidence recommendation based on regulation type and department
    const recommendations = generateEvidenceRecommendations(department ?? "", regulation ?? "", obligation_title ?? "");

    const supabase = getSupabaseServerClient();

    // Insert recommendations as evidence items if they don't exist
    const existing = await supabase.from("evidence").select("title").eq("obligation_id", obligation_id);
    const existingTitles = new Set((existing.data ?? []).map((e: { title: string }) => e.title));

    const toInsert = recommendations
      .filter(r => !existingTitles.has(r.title))
      .map(r => ({ obligation_id, title: r.title, description: r.description }));
    const rows = toInsert.map((row) => ({
      ...row,
      ...(principal.organizationId && { organization_id: principal.organizationId }),
      ...(principal.userId && { created_by: principal.userId }),
    }));

    if (rows.length > 0) {
      await supabase.from("evidence").insert(rows);
    }

    return NextResponse.json({ recommendations, inserted: toInsert.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function generateEvidenceRecommendations(dept: string, regulation: string, title: string): EvidenceRec[] {
  const text = (dept + regulation + title).toLowerCase();
  const all: EvidenceRec[] = [];

  // Universal evidence
  all.push({ title: "Board Approval Letter", description: "Signed board resolution approving the compliance measure." });
  all.push({ title: "Policy Document", description: "Updated policy documentation reflecting the regulatory requirement." });
  all.push({ title: "Compliance Attestation", description: "Signed attestation from department head confirming compliance." });

  if (text.includes("cyber") || text.includes("it") || text.includes("security") || text.includes("vapt") || text.includes("va/pt")) {
    all.push({ title: "VA/PT Report", description: "Vulnerability assessment and penetration testing report with findings and remediation." });
    all.push({ title: "SOC Dashboard Screenshot", description: "Security Operations Center real-time monitoring screenshot." });
    all.push({ title: "Patch Management Log", description: "Evidence of critical security patches applied." });
    all.push({ title: "Network Topology Diagram", description: "Current network architecture with security controls marked." });
  }
  if (text.includes("aml") || text.includes("kyc") || text.includes("fraud") || text.includes("pmla")) {
    all.push({ title: "KYC Audit Report", description: "Customer due diligence and KYC compliance audit results." });
    all.push({ title: "STR Filing Evidence", description: "Suspicious transaction reports filed with FIU-IND." });
    all.push({ title: "AML Training Records", description: "Staff training completion records for AML/CFT awareness." });
  }
  if (text.includes("audit") || text.includes("internal audit")) {
    all.push({ title: "Internal Audit Report", description: "Latest internal audit findings and management actions." });
    all.push({ title: "Closure Certificate", description: "Certificate confirming prior audit findings have been addressed." });
  }
  if (text.includes("capital") || text.includes("basel") || text.includes("crar") || text.includes("finance")) {
    all.push({ title: "Capital Adequacy Statement", description: "CRAR computation and regulatory capital statement." });
    all.push({ title: "Stress Test Results", description: "Quarterly stress testing results submitted to RBI." });
  }
  if (text.includes("bcp") || text.includes("dr") || text.includes("disaster") || text.includes("business continuity")) {
    all.push({ title: "BCP Test Report", description: "Business continuity plan exercise and test results." });
    all.push({ title: "DR Drill Evidence", description: "Disaster recovery drill completion certificate and RTO/RPO metrics." });
  }
  if (text.includes("report") || text.includes("submit") || text.includes("rbi return")) {
    all.push({ title: "Filed Return Copy", description: "Signed copy of the return/report submitted to the regulator." });
    all.push({ title: "Acknowledgment Receipt", description: "Regulator acknowledgment of submission receipt." });
  }
  if (text.includes("training") || text.includes("awareness") || text.includes("staff")) {
    all.push({ title: "Training Attendance Records", description: "Signed attendance sheets or LMS completion records." });
    all.push({ title: "Training Material", description: "Content used for the training/awareness program." });
  }

  return all.slice(0, 6); // Return top 6 relevant recommendations
}

interface EvidenceRec { title: string; description: string }
