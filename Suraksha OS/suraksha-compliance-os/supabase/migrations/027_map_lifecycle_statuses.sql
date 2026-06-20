-- =============================================================================
-- 027: Extend map_status enum ONLY (must be its own committed transaction).
--
-- PostgreSQL does not allow using newly added enum literals in the same
-- transaction as ALTER TYPE ... ADD VALUE (55P04). Backfill + KPI function live
-- in 028_map_lifecycle_backfill_and_kpis.sql — run that immediately after this.
-- =============================================================================

alter type public.map_status add value if not exists 'ai_generated';
alter type public.map_status add value if not exists 'approved';
alter type public.map_status add value if not exists 'assigned';
alter type public.map_status add value if not exists 'under_review';
alter type public.map_status add value if not exists 'rejected';
alter type public.map_status add value if not exists 'escalated';
