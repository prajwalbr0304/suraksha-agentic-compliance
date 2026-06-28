import { getSupabaseServerClient } from "@/lib/supabase/server";

export const SUPPORTED_SECURITY_SOURCES = [
  "wazuh",
  "osquery",
  "trivy",
  "gitleaks",
  "semgrep",
  "defectdojo",
  "manual",
] as const;

export type SecuritySource = (typeof SUPPORTED_SECURITY_SOURCES)[number];

export interface SecurityFindingInput {
  source: SecuritySource;
  external_id?: string;
  title: string;
  description?: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  asset?: string;
  department?: string;
  raw_payload?: Record<string, unknown>;
}

export interface SecurityIntegrationContext {
  organizationId?: string | null;
}

export function isSecuritySource(value: string): value is SecuritySource {
  return (SUPPORTED_SECURITY_SOURCES as readonly string[]).includes(value);
}

export const securityIntegrationsService = {
  async importFindings(
    findings: SecurityFindingInput[],
    context: SecurityIntegrationContext = {}
  ): Promise<{ inserted: number; skipped: number }> {
    if (findings.length === 0) return { inserted: 0, skipped: 0 };

    const rows = findings
      .filter((finding) => finding.title && isSecuritySource(finding.source))
      .map((finding) => ({
        source: finding.source,
        external_id: finding.external_id ?? `${finding.source}-${crypto.randomUUID()}`,
        title: finding.title,
        description: finding.description ?? "",
        severity: finding.severity ?? "medium",
        asset: finding.asset ?? null,
        department: finding.department ?? inferDepartment(finding),
        raw_payload: finding.raw_payload ?? {},
        last_seen_at: new Date().toISOString(),
        ...(context.organizationId && { organization_id: context.organizationId }),
      }));

    if (rows.length === 0) return { inserted: 0, skipped: findings.length };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("integration_findings")
      .upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: false });

    if (error) throw new Error(error.message);
    return { inserted: rows.length, skipped: findings.length - rows.length };
  },
};

function inferDepartment(finding: SecurityFindingInput): string {
  const text = `${finding.title} ${finding.description ?? ""} ${finding.asset ?? ""}`.toLowerCase();
  if (text.includes("container") || text.includes("cve") || text.includes("secret") || text.includes("endpoint")) {
    return "IT";
  }
  if (text.includes("aml") || text.includes("kyc") || text.includes("fraud")) {
    return "Fraud & AML";
  }
  return "Compliance";
}
