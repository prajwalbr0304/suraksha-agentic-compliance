/**
 * Enterprise MAP lifecycle — DB enum ↔ UI column ids.
 * Legacy values (backlog, review) are still understood when reading old rows.
 */

/** Postgres `map_status` enum values (current + legacy) */
export const MAP_DB_STATUSES = [
  "ai_generated",
  "pending_approval",
  "approved",
  "assigned",
  "in_progress",
  "under_review",
  "completed",
  "rejected",
  "escalated",
  "archived",
  "backlog",
  "review",
] as const;

export type MapDbStatus = (typeof MAP_DB_STATUSES)[number];

/** Kanban column ids (hyphenated for React keys / URLs) */
export const MAP_UI_COLUMNS = [
  "ai-generated",
  "pending-approval",
  "approved",
  "assigned",
  "in-progress",
  "under-review",
  "completed",
  "rejected",
  "escalated",
  "archived",
] as const;

export type MapUIColumnId = (typeof MAP_UI_COLUMNS)[number];

export const MAP_COLUMN_LABELS: Record<MapUIColumnId, string> = {
  "ai-generated": "AI generated",
  "pending-approval": "Pending approval",
  approved: "Approved",
  assigned: "Assigned",
  "in-progress": "In progress",
  "under-review": "Under review",
  completed: "Completed",
  rejected: "Rejected",
  escalated: "Escalated",
  archived: "Archived",
};

/** Default DB status for human-created MAPs from the board */
export const DEFAULT_MANUAL_MAP_DB_STATUS: MapDbStatus = "approved";

/** Default DB status when the pipeline creates a MAP (manager must approve before execution). */
export const DEFAULT_AI_MAP_DB_STATUS: MapDbStatus = "pending_approval";

const DB_TO_UI: Record<string, MapUIColumnId> = {
  ai_generated: "ai-generated",
  pending_approval: "pending-approval",
  approved: "approved",
  assigned: "assigned",
  in_progress: "in-progress",
  under_review: "under-review",
  completed: "completed",
  rejected: "rejected",
  escalated: "escalated",
  archived: "archived",
  backlog: "pending-approval",
  review: "under-review",
};

const UI_TO_DB: Record<MapUIColumnId, MapDbStatus> = {
  "ai-generated": "ai_generated",
  "pending-approval": "pending_approval",
  approved: "approved",
  assigned: "assigned",
  "in-progress": "in_progress",
  "under-review": "under_review",
  completed: "completed",
  rejected: "rejected",
  escalated: "escalated",
  archived: "archived",
};

/** Main kanban column order (archived is a DB-only terminal state; cards are hidden from the board). */
export const MAP_UI_COLUMN_ORDER: MapUIColumnId[] = [
  "ai-generated",
  "pending-approval",
  "approved",
  "assigned",
  "in-progress",
  "under-review",
  "completed",
  "rejected",
  "escalated",
];

export function mapDbStatusToColumnId(db: string): MapUIColumnId {
  return DB_TO_UI[db] ?? "pending-approval";
}

export function mapColumnIdToDbStatus(col: string): MapDbStatus {
  if (col in UI_TO_DB) return UI_TO_DB[col as MapUIColumnId];
  return DEFAULT_MANUAL_MAP_DB_STATUS;
}
