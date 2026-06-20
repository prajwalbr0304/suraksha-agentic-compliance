-- =============================================================================
-- Migration 013: Enterprise roles (founder, bank_manager)
-- -----------------------------------------------------------------------------
-- Adds the two new top-of-hierarchy roles from the Enterprise Multi-Tenant
-- Architecture. New enum values must be COMMITTED before they can be referenced
-- by inserts/policies, so this migration only adds the values. The apply runner
-- executes each statement in its own implicit transaction, satisfying Postgres'
-- "unsafe use of new value" rule. Seeding/use happens in migrations 014+.
-- =============================================================================

alter type public.suraksha_role add value if not exists 'founder';
alter type public.suraksha_role add value if not exists 'bank_manager';
