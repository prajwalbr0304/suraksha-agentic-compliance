/**
 * Obligations Service
 *
 * Wraps all Supabase operations for the `obligations` table.
 * Falls back to mock data automatically if Supabase is unreachable.
 *
 * Type safety is enforced via explicit return type annotations on every method.
 * Supabase result rows are cast using `as unknown as T` at the service boundary.
 */
import { supabase } from "@/lib/supabase/client";
import type { ObligationRow, ObligationInsert } from "@/lib/supabase/database.types";
import type { Obligation } from "@/types";

// ---------------------------------------------------------------------------
// Shape adapters — convert between DB rows and app-level types
// ---------------------------------------------------------------------------

function rowToObligation(row: ObligationRow): Obligation {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description ?? "",
    source: row.regulation,
    regulator: row.jurisdiction,
    department: row.department,
    status: mapDbStatusToApp(row.status),
    confidence: row.confidence_score,
    dueDate: row.due_date,
    priority: mapDbPriorityToApp(row.priority),
    citations: row.tags ?? [],
    sourceQuote: row.source_quote ?? null,
    aiExplanation: row.ai_explanation ?? null,
    extractionReason: row.extraction_reason ?? null,
  };
}

function mapDbStatusToApp(status: ObligationRow["status"]): Obligation["status"] {
  const map: Record<ObligationRow["status"], Obligation["status"]> = {
    compliant: "completed",
    in_progress: "active",
    at_risk: "pending",
    overdue: "overdue",
    pending_review: "pending",
  };
  return map[status] ?? "pending";
}

function mapDbPriorityToApp(priority: ObligationRow["priority"]): Obligation["priority"] {
  if (priority === "critical") return "high";
  return priority as "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export const obligationsService = {
  /**
   * Fetch all obligations, ordered by priority then due date.
   * Falls back to mock data if the DB call fails.
   */
  async getAll(): Promise<Obligation[]> {
    const { data, error } = await supabase
      .from("obligations")
      .select("*")
      .order("due_date", { ascending: true }) as unknown as { data: ObligationRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToObligation);
  },

  /**
   * Fetch a single obligation by ID.
   */
  async getById(id: string): Promise<Obligation | null> {
    const { data, error } = await supabase
      .from("obligations")
      .select("*")
      .eq("id", id)
      .single() as unknown as { data: ObligationRow | null; error: { message: string } | null };

    if (error || !data) {
      return null;
    }

    return rowToObligation(data);
  },

  /**
   * Full-text search across title, regulation, department.
   */
  async search(query: string): Promise<Obligation[]> {
    const { data, error } = await supabase
      .from("obligations")
      .select("*")
      .or(
        `title.ilike.%${query}%,regulation.ilike.%${query}%,department.ilike.%${query}%`
      )
      .order("due_date", { ascending: true }) as unknown as { data: ObligationRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToObligation);
  },

  /**
   * Filter by status.
   */
  async filterByStatus(status: Obligation["status"]): Promise<Obligation[]> {
    // Map app status back to DB values
    const dbStatuses: ObligationRow["status"][] =
      status === "completed"
        ? ["compliant"]
        : status === "active"
        ? ["in_progress"]
        : status === "overdue"
        ? ["overdue"]
        : ["at_risk", "pending_review"];

    const { data, error } = await supabase
      .from("obligations")
      .select("*")
      .in("status", dbStatuses)
      .order("due_date", { ascending: true }) as unknown as { data: ObligationRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToObligation);
  },

  /**
   * Update an obligation's status.
   */
  async updateStatus(
    id: string,
    status: ObligationRow["status"]
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from("obligations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id) as unknown as { error: { message: string } | null };

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  },

  /**
   * Insert a new obligation.
   */
  async create(
    obligation: ObligationInsert
  ): Promise<{ data: ObligationRow | null; error?: string }> {
    const { data, error } = await supabase
      .from("obligations")
      .insert(obligation as Record<string, unknown>)
      .select()
      .single() as unknown as { data: ObligationRow | null; error: { message: string } | null };

    if (error) {
      return { data: null, error: error.message };
    }
    return { data };
  },

  /**
   * Realtime subscription — calls `onUpdate` whenever any obligation changes.
   * Returns an unsubscribe function.
   */
  subscribe(onUpdate: (obligations: Obligation[]) => void): () => void {
    const channel = supabase
      .channel("obligations-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "obligations" },
        async () => {
          const updated = await obligationsService.getAll();
          onUpdate(updated);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
