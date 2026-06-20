/**
 * Suraksha Compliance OS — Supabase Database Types
 *
 * These types mirror the Supabase schema exactly.
 * Generated from the logical data model; regenerate with:
 *   npx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > lib/supabase/database.types.ts
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export type ObligationStatus =
  | "compliant"
  | "in_progress"
  | "at_risk"
  | "overdue"
  | "pending_review";

export type ObligationPriority = "critical" | "high" | "medium" | "low";

export type DocumentStatus = "queued" | "processing" | "processed" | "failed";

export type AuditAction =
  | "obligation_created"
  | "obligation_updated"
  | "obligation_closed"
  | "document_uploaded"
  | "document_processed"
  | "risk_flagged"
  | "evidence_added"
  | "review_completed"
  | "alert_generated";

export type RiskTrend = "up" | "down" | "stable";

// ---------------------------------------------------------------------------
// Table row shapes (what Supabase returns on SELECT)
// ---------------------------------------------------------------------------

export interface ObligationRow {
  id: string;
  reference: string;
  title: string;
  description: string;
  regulation: string;
  jurisdiction: string;
  department: string;
  owner: string;
  status: ObligationStatus;
  priority: ObligationPriority;
  due_date: string; // ISO 8601 date string
  confidence_score: number; // 0–100
  evidence_count: number;
  tags: string[];
  /** Explainable AI — regulatory excerpt */
  source_quote?: string | null;
  source_page?: number | null;
  /** Model / pipeline narrative */
  ai_explanation?: string | null;
  /** Structured routing or keyword rationale */
  extraction_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  size: number; // bytes
  mime_type: string;
  storage_path: string; // path within the storage bucket
  status: DocumentStatus;
  obligations_extracted: number;
  confidence_score: number; // 0–100
  uploaded_by: string; // user id or email
  uploaded_at: string;
  processed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditEntryRow {
  id: string;
  action: AuditAction;
  actor: string;
  actor_role: string;
  target: string; // human-readable target description
  target_id: string | null; // obligation / document id if applicable
  details: string; // free-text description
  severity: "info" | "warning" | "critical";
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RiskScoreRow {
  id: string;
  department: string;
  score: number; // 0–100
  trend: RiskTrend;
  overdue_count: number;
  total_obligations: number;
  updated_at: string;
}

export interface ComplianceTrendRow {
  id: string;
  month: string; // e.g. "Jan", "Feb"
  year: number;
  score: number; // 0–100
  obligations: number;
  resolved: number;
  recorded_at: string;
}

export interface EvidenceRow {
  id: string;
  obligation_id: string;
  document_id: string | null;
  title: string;
  description: string;
  collected_at: string;
  created_at: string;
}

export type MapStatus =
  | "ai_generated"
  | "pending_approval"
  | "approved"
  | "assigned"
  | "in_progress"
  | "under_review"
  | "completed"
  | "rejected"
  | "escalated"
  | "archived"
  | "backlog"
  | "review";

export interface MapCardRow {
  id: string;
  title: string;
  obligation_id: string;
  owner: string;
  due_date: string;
  status: MapStatus;
  priority: ObligationPriority;
  comments_count: number;
  escalated: boolean;
  department?: string | null;
  organization_id?: string | null;
  generated_by?: string | null;
  assigned_to?: string | null;
  team_id?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export type MapCardInsert = Omit<MapCardRow, "id" | "created_at" | "updated_at"> & { id?: string };
export type MapCardUpdate = Partial<MapCardInsert> & { updated_at?: string };

// ---------------------------------------------------------------------------
// Insert types (what you pass to Supabase INSERT)
// ---------------------------------------------------------------------------

export type ObligationInsert = Omit<ObligationRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type DocumentInsert = Omit<DocumentRow, "id" | "uploaded_at" | "processed_at"> & {
  id?: string;
};

export type AuditEntryInsert = Omit<AuditEntryRow, "id" | "created_at"> & {
  id?: string;
};

export type EvidenceInsert = Omit<EvidenceRow, "id" | "created_at"> & {
  id?: string;
};

// ---------------------------------------------------------------------------
// Update types (all fields optional except id-like keys)
// ---------------------------------------------------------------------------

export type ObligationUpdate = Partial<ObligationInsert> & { updated_at?: string };
export type DocumentUpdate = Partial<DocumentInsert>;

// ---------------------------------------------------------------------------
// Json scalar (required by supabase-js v2 generic)
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface MapActivityRow {
  id: string;
  map_card_id: string;
  organization_id: string;
  actor_user_id: string | null;
  event_type: string;
  summary: string;
  metadata: Json;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Full Database interface — shaped to match supabase-js v2 generic contract
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      obligations: {
        Row: ObligationRow;
        Insert: ObligationInsert;
        Update: ObligationUpdate;
        Relationships: [];
      };
      documents: {
        Row: DocumentRow;
        Insert: DocumentInsert;
        Update: DocumentUpdate;
        Relationships: [];
      };
      audit_trail: {
        Row: AuditEntryRow;
        Insert: AuditEntryInsert;
        Update: Partial<AuditEntryInsert>;
        Relationships: [];
      };
      risk_scores: {
        Row: RiskScoreRow;
        Insert: Omit<RiskScoreRow, "id" | "updated_at"> & { id?: string };
        Update: Partial<RiskScoreRow>;
        Relationships: [];
      };
      compliance_trends: {
        Row: ComplianceTrendRow;
        Insert: Omit<ComplianceTrendRow, "id" | "recorded_at"> & { id?: string };
        Update: Partial<ComplianceTrendRow>;
        Relationships: [];
      };
      evidence: {
        Row: EvidenceRow;
        Insert: EvidenceInsert;
        Update: Partial<EvidenceInsert>;
        Relationships: [];
      };
      map_cards: {
        Row: MapCardRow;
        Insert: MapCardInsert;
        Update: MapCardUpdate;
        Relationships: [];
      };
      map_activity: {
        Row: MapActivityRow;
        Insert: Omit<MapActivityRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Omit<MapActivityRow, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      obligation_status: ObligationStatus;
      obligation_priority: ObligationPriority;
      document_status: DocumentStatus;
      audit_action: AuditAction;
      risk_trend: RiskTrend;
    };
    CompositeTypes: Record<string, never>;
  };
};
