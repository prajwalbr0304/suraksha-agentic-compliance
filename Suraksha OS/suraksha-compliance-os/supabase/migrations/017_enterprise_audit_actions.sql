-- =============================================================================
-- Migration 017: Audit action enum values for enterprise admin + agent events
-- (new enum values are committed per-statement by the apply runner)
-- =============================================================================

alter type public.audit_action add value if not exists 'user_created';
alter type public.audit_action add value if not exists 'user_updated';
alter type public.audit_action add value if not exists 'user_deactivated';
alter type public.audit_action add value if not exists 'role_assigned';
alter type public.audit_action add value if not exists 'permission_changed';
alter type public.audit_action add value if not exists 'department_created';
alter type public.audit_action add value if not exists 'department_updated';
alter type public.audit_action add value if not exists 'team_created';
alter type public.audit_action add value if not exists 'bank_created';
alter type public.audit_action add value if not exists 'bank_suspended';
alter type public.audit_action add value if not exists 'settings_changed';
alter type public.audit_action add value if not exists 'agent_run';
alter type public.audit_action add value if not exists 'regulation_detected';
alter type public.audit_action add value if not exists 'map_generated';
alter type public.audit_action add value if not exists 'map_validated';
