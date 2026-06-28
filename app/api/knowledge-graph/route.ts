import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { filterAccessibleRows, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

function deptSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "unknown";
}

function riskHeat(priority: string | undefined, status: string | undefined): "critical" | "elevated" | "steady" | "complete" {
  const p = (priority ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "compliant" || s === "mapped" || s === "rejected") return "complete";
  if (p === "critical" || s === "overdue" || s === "at_risk" || s === "error" || s === "escalated") return "critical";
  if (
    p === "high" ||
    s === "in_progress" ||
    s === "processing" ||
    s === "review" ||
    s === "under_review" ||
    s === "assigned"
  )
    return "elevated";
  if (s === "pending_approval" || s === "ai_generated" || s === "approved" || s === "backlog") return "steady";
  return "steady";
}

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const supabase = getSupabaseServerClient();
    const orgId = principal.organizationId!;

    const [
      oblRes,
      docRes,
      mapRes,
      evRes,
      regRes,
      deptRes,
      teamRes,
      orgMembersRes,
    ] = await Promise.all([
      supabase
        .from("obligations")
        .select("id, title, department, priority, status, compliance_risk, regulation, confidence_score, document_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("documents")
        .select("id, name, status")
        .eq("organization_id", orgId)
        .in("status", ["processed", "processing", "queued"])
        .order("uploaded_at", { ascending: false })
        .limit(20),
      supabase
        .from("map_cards")
        .select("id, title, obligation_id, status, priority, assigned_to, department, generated_by, due_date, team_id")
        .eq("organization_id", orgId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("evidence")
        .select("id, title, obligation_id, collected_at, approval_status, created_by")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("regulatory_changes")
        .select("id, title, status, document_id, regulator")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("departments").select("id, name").eq("organization_id", orgId),
      supabase.from("teams").select("id, name, department_id").eq("organization_id", orgId),
      supabase.from("organization_members").select("user_id, team_id").eq("organization_id", orgId),
    ]);

    if (oblRes.error) throw new Error(oblRes.error.message);

    const obligations = filterAccessibleRows(principal, oblRes.data ?? []);
    const documents = filterAccessibleRows(principal, docRes.data ?? []);
    const mapCards = filterAccessibleRows(principal, mapRes.data ?? []);
    const evidence = filterAccessibleRows(principal, evRes.data ?? []);
    const regulatoryChanges = filterAccessibleRows(principal, regRes.data ?? []);
    const deptRows = filterAccessibleRows(principal, deptRes.data ?? []);
    const teamRows = filterAccessibleRows(principal, teamRes.data ?? []);

    const deptNameToId = new Map<string, string>();
    for (const d of deptRows) {
      const name = String(d.name ?? "").trim().toLowerCase();
      if (name) deptNameToId.set(name, d.id as string);
    }

    const oblById = new Map((obligations as { id: string; department?: string }[]).map((o) => [o.id, o]));

    const evidenceList = evidence as {
      id: string;
      obligation_id: string;
      title: string;
      collected_at?: string | null;
      approval_status?: string;
      created_by?: string | null;
    }[];
    const evidenceByObligation = new Map<string, typeof evidenceList>();
    for (const ev of evidenceList) {
      const list = evidenceByObligation.get(ev.obligation_id) ?? [];
      list.push(ev);
      evidenceByObligation.set(ev.obligation_id, list);
    }

    function resolveDepartmentNodeId(departmentLabel: string | null | undefined): string | null {
      const raw = (departmentLabel ?? "").trim();
      if (!raw) return null;
      const id = deptNameToId.get(raw.toLowerCase());
      if (id) return `dept-${id}`;
      return `dept-fallback-${deptSlug(raw)}`;
    }

    const assignedIds = [
      ...new Set(
        (mapCards as { assigned_to?: string | null }[])
          .map((m) => m.assigned_to)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    ];

    const memberRows = (orgMembersRes.data ?? []) as { user_id: string; team_id: string | null }[];
    const teamIdsInGraph = new Set((teamRows as { id: string }[]).map((t) => t.id));

    const graphUserIds = new Set<string>(assignedIds);
    for (const row of memberRows) {
      const tid = row.team_id as string | null;
      if (tid && teamIdsInGraph.has(tid)) graphUserIds.add(row.user_id as string);
    }
    for (const ev of evidenceList) {
      const uid = ev.created_by as string | null | undefined;
      if (uid) graphUserIds.add(uid);
    }
    const profileIds = [...graphUserIds];

    let profiles: { id: string; full_name: string | null; email: string }[] = [];
    if (profileIds.length > 0) {
      const profRes = await supabase.from("profiles").select("id, full_name, email").in("id", profileIds);
      if (!profRes.error) profiles = (profRes.data ?? []) as typeof profiles;
    }

    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const deptNodeIds = new Set<string>();

    // ── Regulation (detected changes) ─────────────────────────────────────
    (regulatoryChanges as { id: string; title: string; status?: string; document_id?: string | null; regulator?: string | null }[]).forEach((rc) => {
      nodes.push({
        id: `reg-${rc.id}`,
        type: "regulation",
        label: rc.title?.slice(0, 56) ?? "Regulatory change",
        data: {
          status: rc.status,
          regulator: rc.regulator,
          heat: riskHeat(undefined, rc.status),
          icon: "ScrollText",
          entityId: rc.id,
        },
      });
      if (rc.document_id) {
        edges.push({
          id: `edge-reg-doc-${rc.id}`,
          source: `reg-${rc.id}`,
          target: `doc-${rc.document_id}`,
          label: "linked document",
        });
      }
    });

    // ── Documents ──────────────────────────────────────────────────────────
    (documents as { id: string; name: string; status: string }[]).forEach((doc) => {
      nodes.push({
        id: `doc-${doc.id}`,
        type: "document",
        label: doc.name?.replace(/\.pdf$/i, "") ?? "Document",
        data: {
          status: doc.status,
          heat: doc.status === "processed" ? "complete" : "elevated",
          icon: "FileText",
          entityId: doc.id,
        },
      });
    });

    // ── Departments (canonical org departments + fallbacks used on cards) ──
    (deptRows as { id: string; name: string }[]).forEach((d) => {
      const nid = `dept-${d.id}`;
      deptNodeIds.add(nid);
      nodes.push({
        id: nid,
        type: "department",
        label: d.name,
        data: { icon: "Building2", entityId: d.id, heat: "steady" },
      });
    });

    // ── Teams ─────────────────────────────────────────────────────────────
    (teamRows as { id: string; name: string; department_id?: string | null }[]).forEach((t) => {
      nodes.push({
        id: `team-${t.id}`,
        type: "team",
        label: t.name,
        data: { icon: "Users", entityId: t.id, heat: "steady" },
      });
      if (t.department_id) {
        const tid = `dept-${t.department_id}`;
        if (deptNodeIds.has(tid)) {
          edges.push({
            id: `edge-team-dept-${t.id}`,
            source: `team-${t.id}`,
            target: tid,
            label: "belongs to",
          });
        }
      }
    });

    // ── Employees (MAP assignees + org members on teams in graph) ───────────
    for (const uid of graphUserIds) {
      const p = profileById.get(uid);
      const label = p?.full_name?.trim() || p?.email?.trim() || "Assigned user";
      nodes.push({
        id: `user-${uid}`,
        type: "employee",
        label: label.slice(0, 48),
        data: {
          icon: "User",
          entityId: uid,
          email: p?.email,
          heat: "steady",
        },
      });
    }

    // Team → member (organization_members.team_id)
    const seenTeamUser = new Set<string>();
    for (const row of memberRows) {
      const uid = row.user_id as string;
      const tid = row.team_id as string | null;
      if (!tid || !teamIdsInGraph.has(tid)) continue;
      const key = `${tid}:${uid}`;
      if (seenTeamUser.has(key)) continue;
      seenTeamUser.add(key);
      edges.push({
        id: `edge-team-member-${tid}-${uid}`,
        source: `team-${tid}`,
        target: `user-${uid}`,
        label: "assigned_to_user",
      });
    }

    // ── Obligations ─────────────────────────────────────────────────────────
    (obligations as {
      id: string;
      title: string;
      department: string;
      priority: string;
      status: string;
      compliance_risk?: string | null;
      regulation: string;
      confidence_score: number;
      document_id?: string | null;
    }[]).forEach((obl) => {
      const deptNid = resolveDepartmentNodeId(obl.department);
      if (deptNid && deptNid.startsWith("dept-fallback-")) {
        if (!nodes.some((n) => n.id === deptNid)) {
          nodes.push({
            id: deptNid,
            type: "department",
            label: obl.department,
            data: { icon: "Building2", heat: "steady", synthetic: true },
          });
        }
      }

      nodes.push({
        id: `obl-${obl.id}`,
        type: "obligation",
        label: obl.title?.slice(0, 52) ?? "Obligation",
        data: {
          priority: obl.priority,
          status: obl.status,
          risk: obl.compliance_risk,
          confidence: obl.confidence_score,
          regulation: obl.regulation,
          heat: riskHeat(obl.priority, obl.status),
          icon: "Scale",
          entityId: obl.id,
        },
      });

      if (obl.document_id) {
        edges.push({
          id: `edge-doc-obl-${obl.id}`,
          source: `doc-${obl.document_id}`,
          target: `obl-${obl.id}`,
          label: "sourced obligation",
        });
      } else if (documents.length > 0) {
        // Weak fallback when lineage not stored yet (legacy rows)
        const fallback = documents[0] as { id: string };
        edges.push({
          id: `edge-doc-obl-fb-${obl.id}`,
          source: `doc-${fallback.id}`,
          target: `obl-${obl.id}`,
          label: "related doc",
        });
      }

      const dId = resolveDepartmentNodeId(obl.department);
      if (dId) {
        edges.push({
          id: `edge-obl-dept-${obl.id}`,
          source: `obl-${obl.id}`,
          target: dId,
          label: "owned by",
        });
      }
    });

    // ── MAP cards ─────────────────────────────────────────────────────────
    (mapCards as {
      id: string;
      title: string;
      obligation_id: string;
      status: string;
      priority: string;
      assigned_to?: string | null;
      team_id?: string | null;
      department?: string | null;
      generated_by?: string | null;
      due_date?: string | null;
    }[]).forEach((card) => {
      const obl = oblById.get(card.obligation_id) as { department?: string } | undefined;
      const deptLabel = card.department || obl?.department;
      const deptNid = resolveDepartmentNodeId(deptLabel);
      if (deptNid?.startsWith("dept-fallback-") && !nodes.some((n) => n.id === deptNid) && deptLabel) {
        nodes.push({
          id: deptNid,
          type: "department",
          label: String(deptLabel),
          data: { icon: "Building2", heat: "steady", synthetic: true },
        });
      }

      nodes.push({
        id: `map-${card.id}`,
        type: "map_action",
        label: card.title?.slice(0, 48) ?? "MAP",
        data: {
          status: card.status,
          priority: card.priority,
          dueDate: card.due_date,
          generatedBy: card.generated_by,
          aiSuggested: (card.generated_by ?? "") === "ai" || (card.generated_by ?? "") === "pipeline",
          heat: riskHeat(card.priority, card.status),
          icon: "GitBranch",
          entityId: card.id,
        },
      });

      edges.push({
        id: `edge-obl-map-${card.id}`,
        source: `obl-${card.obligation_id}`,
        target: `map-${card.id}`,
        label: "generates MAP",
      });

      if (deptNid) {
        edges.push({
          id: `edge-map-dept-${card.id}`,
          source: `map-${card.id}`,
          target: deptNid,
          label: "assigned dept",
        });
      }

      const cardTeamId = card.team_id as string | null | undefined;
      if (cardTeamId && teamIdsInGraph.has(cardTeamId)) {
        edges.push({
          id: `edge-map-team-card-${card.id}`,
          source: `map-${card.id}`,
          target: `team-${cardTeamId}`,
          label: "assigned_to_team",
        });
      }

      if (card.assigned_to) {
        edges.push({
          id: `edge-map-user-${card.id}`,
          source: `map-${card.id}`,
          target: `user-${card.assigned_to}`,
          label: "assigned_to_user",
        });
      }

      const evForObl = evidenceByObligation.get(card.obligation_id) ?? [];
      for (const ev of evForObl) {
        edges.push({
          id: `edge-map-ev-${card.id}-${ev.id}`,
          source: `map-${card.id}`,
          target: `ev-${ev.id}`,
          label: "evidence path",
        });
      }
    });

    // ── Evidence ───────────────────────────────────────────────────────────
    evidenceList.forEach((ev) => {
      nodes.push({
        id: `ev-${ev.id}`,
        type: "evidence",
        label: ev.title?.slice(0, 44) ?? "Evidence",
        data: {
          collected: !!ev.collected_at,
          approvalStatus: ev.approval_status,
          heat: ev.approval_status === "approved" ? "complete" : riskHeat(undefined, String(ev.approval_status ?? "")),
          icon: "ShieldCheck",
          entityId: ev.id,
        },
      });
      edges.push({
        id: `edge-obl-ev-${ev.id}`,
        source: `obl-${ev.obligation_id}`,
        target: `ev-${ev.id}`,
        label: "mitigates",
      });
      const uploader = ev.created_by as string | null | undefined;
      if (uploader && ev.collected_at) {
        edges.push({
          id: `edge-user-ev-${ev.id}`,
          source: `user-${uploader}`,
          target: `ev-${ev.id}`,
          label: "uploaded",
        });
      }
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const safeEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    const byType: Record<string, number> = {};
    for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;

    return NextResponse.json({
      nodes,
      edges: safeEdges,
      summary: { nodes: nodes.length, edges: safeEdges.length, byType },
    });
  } catch (err) {
    console.error("[knowledge-graph]", err);
    return NextResponse.json({ nodes: [], edges: [], summary: { nodes: 0, edges: 0, byType: {} } });
  }
}

interface GraphNode {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}
