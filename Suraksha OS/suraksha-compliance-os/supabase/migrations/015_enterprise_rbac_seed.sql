-- =============================================================================
-- Migration 015: RBAC seed for founder + bank_manager
-- =============================================================================

insert into public.role_permissions (role, permission) values
  -- Founder: full platform authority (admin.all short-circuits every check).
  ('founder', 'admin.all'),
  -- Bank Manager: full administration within their own organization.
  ('bank_manager', 'users.manage'),
  ('bank_manager', 'departments.manage'),
  ('bank_manager', 'teams.manage'),
  ('bank_manager', 'roles.manage'),
  ('bank_manager', 'permissions.manage'),
  ('bank_manager', 'settings.manage'),
  ('bank_manager', 'documents.read'),
  ('bank_manager', 'documents.upload'),
  ('bank_manager', 'documents.delete'),
  ('bank_manager', 'obligations.create'),
  ('bank_manager', 'obligations.assign'),
  ('bank_manager', 'obligations.approve'),
  ('bank_manager', 'evidence.create'),
  ('bank_manager', 'evidence.approve'),
  ('bank_manager', 'security.findings.read'),
  ('bank_manager', 'reports.export'),
  ('bank_manager', 'audit.read')
on conflict (role, permission) do nothing;
