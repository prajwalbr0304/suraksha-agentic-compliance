import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { RequestPrincipal } from "@/lib/auth/permissions";

type SupabaseServer = ReturnType<typeof getSupabaseServerClient>;

export interface AuditInput {
  action: string;
  target: string;
  targetId?: string | null;
  details: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
  /** Override the principal's org (e.g. founder acting on a specific bank). */
  organizationId?: string | null;
}

/**
 * Server-side audit_trail writer. Best-effort: never throws (audit must not
 * break the primary operation). Scopes by principal org + actor.
 */
export async function writeAudit(
  supabase: SupabaseServer,
  principal: RequestPrincipal,
  input: AuditInput
): Promise<void> {
  try {
    const orgId = input.organizationId ?? principal.organizationId;
    await supabase.from("audit_trail").insert({
      action: input.action,
      actor: principal.email,
      actor_role: principal.role,
      target: input.target,
      target_id: input.targetId ?? null,
      details: input.details,
      severity: input.severity ?? "info",
      metadata: input.metadata ?? {},
      ...(orgId && { organization_id: orgId }),
      ...(principal.userId && { actor_user_id: principal.userId }),
    });
  } catch {
    // swallow — auditing is best-effort
  }
}
