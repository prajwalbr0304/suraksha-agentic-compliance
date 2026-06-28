/**
 * Supabase module barrel export
 */
export { supabase } from "./client";
export { getSupabaseServerClient } from "./server";
export type { Database } from "./database.types";
export type {
  ObligationRow,
  ObligationInsert,
  ObligationUpdate,
  ObligationStatus,
  ObligationPriority,
  DocumentRow,
  DocumentInsert,
  DocumentStatus,
  AuditEntryRow,
  AuditEntryInsert,
  AuditAction,
  RiskScoreRow,
  ComplianceTrendRow,
  EvidenceRow,
  EvidenceInsert,
  RiskTrend,
} from "./database.types";
