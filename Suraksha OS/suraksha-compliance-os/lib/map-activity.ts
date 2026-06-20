import type { SupabaseClient } from "@supabase/supabase-js";

export type MapActivityEventType =
  | "map_created"
  | "status_changed"
  | "team_set"
  | "employee_assigned"
  | "employee_unassigned"
  | "map_updated"
  | "archived"
  | "evidence_linked";

export async function appendMapActivity(
  supabase: SupabaseClient,
  row: {
    organization_id: string;
    map_card_id: string;
    actor_user_id: string | null;
    event_type: MapActivityEventType | string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("map_activity").insert({
    organization_id: row.organization_id,
    map_card_id: row.map_card_id,
    actor_user_id: row.actor_user_id,
    event_type: row.event_type,
    summary: row.summary,
    metadata: row.metadata ?? {},
  });
  if (error) {
    console.warn("[map_activity] insert failed:", error.message);
  }
}
