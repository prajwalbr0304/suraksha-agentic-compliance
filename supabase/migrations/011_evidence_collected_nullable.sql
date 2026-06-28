-- =============================================================================
-- Migration 011: Make evidence.collected_at nullable
-- -----------------------------------------------------------------------------
-- The Evidence "mark as collected / uncollected" flow (PUT /api/evidence) sets
-- collected_at = null when an item is un-collected, and the app treats a null
-- collected_at as "pending". The original column was NOT NULL with a default of
-- current_date, which (a) made every item look collected and (b) caused the
-- un-collect path to fail. Drop the NOT NULL + default so pending is representable.
-- =============================================================================

alter table public.evidence alter column collected_at drop default;
alter table public.evidence alter column collected_at drop not null;
