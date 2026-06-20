import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORTED_SECURITY_SOURCES,
  isSecuritySource,
  securityIntegrationsService,
  type SecurityFindingInput,
} from "@/lib/services/security-integrations.service";
import { filterAccessibleRows, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "security.findings.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  const query = supabase.from("integration_findings").select("*").order("last_seen_at", { ascending: false }).limit(100).eq("organization_id", principal.organizationId!);
  const { data } = await query;

  return NextResponse.json({
    supported_sources: SUPPORTED_SECURITY_SOURCES,
    findings: filterAccessibleRows(principal, data ?? []),
    accepted_shape: {
      findings: [
        {
          source: "trivy",
          external_id: "CVE-2026-example",
          title: "Critical package vulnerability",
          severity: "critical",
          asset: "core-api",
          department: "IT",
          raw_payload: {},
        },
      ],
    },
  });
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "security.findings.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  let body: { findings?: SecurityFindingInput[] } | SecurityFindingInput[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const findings = Array.isArray(body) ? body : body.findings;
  if (!Array.isArray(findings)) {
    return NextResponse.json({ error: "Expected findings array" }, { status: 400 });
  }

  const invalidSource = findings.find((finding) => !isSecuritySource(String(finding.source)));
  if (invalidSource) {
    return NextResponse.json({ error: `Unsupported source: ${String(invalidSource.source)}` }, { status: 400 });
  }

  try {
    const result = await securityIntegrationsService.importFindings(findings, {
      organizationId: principal.organizationId,
    });

    // Audit log for security findings import
    const supabase = (await import("@/lib/supabase/server")).getSupabaseServerClient();
    await writeAudit(supabase, principal, {
      action: "risk_flagged",
      target: `security-findings-import`,
      details: `Imported ${result.inserted} security findings from ${[...new Set(findings.map((f: { source: string }) => f.source))].join(", ")}`,
      metadata: { inserted: result.inserted, skipped: result.skipped },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
