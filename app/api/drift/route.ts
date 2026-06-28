import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

// GET — list past comparisons
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const supabase = getSupabaseServerClient();
    const query = supabase
      .from("drift_comparisons")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)
      .eq("organization_id", principal.organizationId!);
    const { data, error } = await query;
    if (!error && data) return NextResponse.json(data);
    // Table doesn't exist — return empty (history requires migration)
    return NextResponse.json([]);
  } catch {
    return NextResponse.json([]);
  }
}

// POST — run drift comparison between two document IDs
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const { base_doc_id, new_doc_id } = await req.json();
    if (!base_doc_id || !new_doc_id) {
      return NextResponse.json({ error: "base_doc_id and new_doc_id required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    // Verify both documents belong to the caller's org (IDOR fix)
    if (principal.organizationId) {
      const [{ data: d1 }, { data: d2 }] = await Promise.all([
        supabase.from("documents").select("id").eq("id", base_doc_id).eq("organization_id", principal.organizationId).maybeSingle(),
        supabase.from("documents").select("id").eq("id", new_doc_id).eq("organization_id", principal.organizationId).maybeSingle(),
      ]);
      if (!d1) return NextResponse.json({ error: "Base document not found in your organization" }, { status: 403 });
      if (!d2) return NextResponse.json({ error: "New document not found in your organization" }, { status: 403 });
    }

    // Fetch obligations for both docs (scoped to org)
    let oblQuery1 = supabase.from("obligations").select("id, title, description, department, priority, status, compliance_risk, citation").eq("document_id", base_doc_id);
    let oblQuery2 = supabase.from("obligations").select("id, title, description, department, priority, status, compliance_risk, citation").eq("document_id", new_doc_id);
    if (principal.organizationId) {
      oblQuery1 = oblQuery1.eq("organization_id", principal.organizationId);
      oblQuery2 = oblQuery2.eq("organization_id", principal.organizationId);
    }
    const [{ data: baseObls }, { data: newObls }] = await Promise.all([oblQuery1, oblQuery2]);

    // Fetch doc metadata (scoped)
    let docQuery1 = supabase.from("documents").select("filename, uploaded_at").eq("id", base_doc_id);
    let docQuery2 = supabase.from("documents").select("filename, uploaded_at").eq("id", new_doc_id);
    if (principal.organizationId) {
      docQuery1 = docQuery1.eq("organization_id", principal.organizationId);
      docQuery2 = docQuery2.eq("organization_id", principal.organizationId);
    }
    const [{ data: baseDoc }, { data: newDoc }] = await Promise.all([
      docQuery1.maybeSingle(),
      docQuery2.maybeSingle(),
    ]);

    const baseList = baseObls ?? [];
    const newList = newObls ?? [];

    // Simple semantic diff using title similarity
    const changes: DriftChange[] = [];
    const matchedNewIds = new Set<string>();

    baseList.forEach((baseObl) => {
      const match = newList.find((n) => {
        const sim = titleSimilarity(baseObl.title ?? "", n.title ?? "");
        return sim > 0.6;
      });

      if (!match) {
        changes.push({
          type: "removed",
          title: baseObl.title ?? "",
          base_citation: baseObl.citation ?? "",
          new_citation: "",
          department: baseObl.department ?? "",
          priority_change: null,
          detail: "This obligation was present in the earlier circular but is absent from the new version.",
        });
      } else {
        matchedNewIds.add(match.id);
        const priorityChanged = match.priority !== baseObl.priority;
        const riskChanged = match.compliance_risk !== baseObl.compliance_risk;
        const deptChanged = match.department !== baseObl.department;

        if (priorityChanged || riskChanged || deptChanged) {
          changes.push({
            type: "changed",
            title: baseObl.title ?? "",
            base_citation: baseObl.citation ?? "",
            new_citation: match.citation ?? "",
            department: match.department ?? "",
            priority_change: priorityChanged ? { from: baseObl.priority ?? "", to: match.priority ?? "" } : null,
            risk_change: riskChanged ? { from: baseObl.compliance_risk ?? "", to: match.compliance_risk ?? "" } : null,
            dept_change: deptChanged ? { from: baseObl.department ?? "", to: match.department ?? "" } : null,
            detail: buildChangeDetail(baseObl, match),
          });
        }
      }
    });

    newList.filter((n) => !matchedNewIds.has(n.id)).forEach((newObl) => {
      changes.push({
        type: "new",
        title: newObl.title ?? "",
        base_citation: "",
        new_citation: newObl.citation ?? "",
        department: newObl.department ?? "",
        priority_change: null,
        detail: `New obligation introduced. Priority: ${newObl.priority}. Department: ${newObl.department}.`,
      });
    });

    const newCount = changes.filter(c => c.type === "new").length;
    const removedCount = changes.filter(c => c.type === "removed").length;
    const changedCount = changes.filter(c => c.type === "changed").length;

    const driftScore = Math.min(100,
      (newCount * 10 + removedCount * 8 + changedCount * 4) / Math.max(baseList.length, 1) * 100
    );

    const summary = `Comparing "${baseDoc?.filename ?? "Base"}" vs "${newDoc?.filename ?? "New"}". ` +
      `${newCount} new obligation(s), ${removedCount} removed, ${changedCount} modified. ` +
      `Regulatory drift score: ${driftScore.toFixed(0)}/100.`;

    // Try to persist to dedicated table (may not exist yet)
    let savedId: string | undefined;
    const driftPayload = {
      base_doc_id, new_doc_id, status: "completed", summary,
      new_obligations: newCount, removed_obligations: removedCount,
      changed_obligations: changedCount, drift_score: driftScore,
      changes_json: changes, completed_at: new Date().toISOString(),
      ...(principal.organizationId && { organization_id: principal.organizationId }),
    };

    try {
      const { data: record, error: driftErr } = await supabase.from("drift_comparisons").insert(driftPayload).select("id").single();
      if (!driftErr && record) savedId = record.id;
    } catch {
      // Table doesn't exist yet — result returned without persistence
    }
    return NextResponse.json({
      id: savedId,
      summary,
      drift_score: driftScore,
      changes,
      stats: { new: newCount, removed: removedCount, changed: changedCount, total_base: baseList.length, total_new: newList.length },
      base_doc: baseDoc,
      new_doc: newDoc,
    });
  } catch (err) {
    console.error("[drift]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────
function titleSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildChangeDetail(base: Record<string, unknown>, next: Record<string, unknown>): string {
  const parts: string[] = [];
  if (base.priority !== next.priority) parts.push(`Priority changed from ${base.priority} → ${next.priority}`);
  if (base.compliance_risk !== next.compliance_risk) parts.push(`Risk changed from ${base.compliance_risk} → ${next.compliance_risk}`);
  if (base.department !== next.department) parts.push(`Department reassigned from ${base.department} → ${next.department}`);
  return parts.join(". ") + ".";
}

interface DriftChange {
  type: "new" | "removed" | "changed";
  title: string;
  base_citation: string;
  new_citation: string;
  department: string;
  priority_change: { from: string; to: string } | null;
  risk_change?: { from: string; to: string } | null;
  dept_change?: { from: string; to: string } | null;
  detail: string;
}
