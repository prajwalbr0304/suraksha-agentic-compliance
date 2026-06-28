-- =============================================================================
-- Migration 010: RBAC — give org_admin full organization oversight
-- -----------------------------------------------------------------------------
-- Previously org_admin only had settings.manage + users.manage, which meant the
-- Organization Admin could not even read its own org's documents/obligations
-- (every data API returned 403 and the /dashboard was empty). An org admin is
-- the top organization role and must be able to see and manage everything in
-- their org (short of platform-wide admin.all).
-- =============================================================================

insert into public.role_permissions (role, permission) values
  ('org_admin', 'documents.read'),
  ('org_admin', 'documents.upload'),
  ('org_admin', 'documents.delete'),
  ('org_admin', 'obligations.create'),
  ('org_admin', 'obligations.assign'),
  ('org_admin', 'obligations.approve'),
  ('org_admin', 'evidence.create'),
  ('org_admin', 'evidence.approve'),
  ('org_admin', 'reports.export'),
  ('org_admin', 'audit.read'),
  ('org_admin', 'security.findings.read')
on conflict (role, permission) do nothing;
