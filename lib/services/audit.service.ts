/**
 * Audit Trail Service
 *
 * Wraps all Supabase operations for the `audit_trail` table.
 * Falls back to mock data if the table is not yet seeded.
 */
import { supabase } from "@/lib/supabase/client";
import type { AuditEntryInsert, AuditEntryRow } from "@/lib/supabase/database.types";
import type { AuditEntry } from "@/types";

// ---------------------------------------------------------------------------
// Shape adapter
// ---------------------------------------------------------------------------

function rowToAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    actor: row.actor,
    action: row.details,
    target: row.target,
    timestamp: row.created_at,
    type: mapAuditType(row.action),
    metadata: row.metadata as Record<string, string> | undefined,
  };
}

function mapAuditType(action: AuditEntryRow["action"]): AuditEntry["type"] {
  const map: Record<AuditEntryRow["action"], AuditEntry["type"]> = {
    obligation_created: "extraction",
    obligation_updated: "modification",
    obligation_closed: "approval",
    document_uploaded: "upload",
    document_processed: "extraction",
    risk_flagged: "escalation",
    evidence_added: "review",
    review_completed: "review",
    alert_generated: "escalation",
  };
  return map[action] ?? "review";
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export const auditService = {
  /**
   * Fetch recent audit entries, most recent first.
   */
  async getRecent(limit = 20): Promise<AuditEntry[]> {
    const { data, error } = await supabase
      .from("audit_trail")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit) as unknown as { data: AuditEntryRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToAuditEntry);
  },

  /**
   * Append a new audit entry.
   * Call this whenever a significant user action occurs.
   */
  async log(entry: AuditEntryInsert): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from("audit_trail")
      .insert(entry as Record<string, unknown>) as unknown as { error: { message: string } | null };
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  },

  /**
   * Realtime subscription — calls `onNew` for every INSERT to audit_trail.
   */
  subscribe(onNew: (entry: AuditEntry) => void): () => void {
    const channel = supabase
      .channel("audit-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_trail" },
        (payload) => {
          onNew(rowToAuditEntry(payload.new as AuditEntryRow));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
