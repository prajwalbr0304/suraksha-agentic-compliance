-- =============================================================================
-- Migration 016: Founder RLS bypass + bank_manager org-wide scoping
-- -----------------------------------------------------------------------------
-- - is_founder(): true when the current auth user is a platform founder.
-- - Founders bypass tenant isolation on browser-read tables.
-- - bank_manager + founder are treated as org-wide (see all departments).
-- - RLS for new tables: founders, teams, user_permissions, per-org departments.
-- =============================================================================

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.founders f where f.id = auth.uid())
$$;

-- Treat bank_manager + founder as organization-wide (bypass department scoping).
create or replace function public.is_org_wide_role(org_id uuid default public.current_organization_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_founder()
    or public.current_user_role(org_id) in (
      'platform_admin',
      'founder',
      'bank_manager',
      'org_admin',
      'compliance_admin',
      'compliance_analyst',
      'internal_auditor',
      'executive_viewer',
      'external_auditor'
    )
$$;

-- ── Founder bypass on browser-read tables (added in 012) ──────────────────────
drop policy if exists "Authenticated can read risk_scores" on public.risk_scores;
create policy "Authenticated can read risk_scores"
  on public.risk_scores for select to authenticated using (true);

drop policy if exists "Authenticated can read compliance_trends" on public.compliance_trends;
create policy "Authenticated can read compliance_trends"
  on public.compliance_trends for select to authenticated using (true);

drop policy if exists "Authenticated can read org audit_trail" on public.audit_trail;
create policy "Authenticated can read org audit_trail"
  on public.audit_trail for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read org readiness_scores" on public.readiness_scores;
create policy "Authenticated can read org readiness_scores"
  on public.readiness_scores for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read org escalations" on public.escalations;
create policy "Authenticated can read org escalations"
  on public.escalations for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

-- ── New tables RLS ────────────────────────────────────────────────────────────
alter table public.founders enable row level security;
drop policy if exists "Founders read founders" on public.founders;
create policy "Founders read founders"
  on public.founders for select to authenticated
  using (public.is_founder() or id = auth.uid());

alter table public.teams enable row level security;
drop policy if exists "Members read org teams" on public.teams;
create policy "Members read org teams"
  on public.teams for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());
drop policy if exists "Managers manage org teams" on public.teams;
create policy "Managers manage org teams"
  on public.teams for all to authenticated
  using (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('teams.manage', organization_id)))
  with check (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('teams.manage', organization_id)));

alter table public.user_permissions enable row level security;
drop policy if exists "Members read org user_permissions" on public.user_permissions;
create policy "Members read org user_permissions"
  on public.user_permissions for select to authenticated
  using (public.is_founder() or user_id = auth.uid() or (organization_id = public.current_organization_id() and public.has_permission('permissions.manage', organization_id)));
drop policy if exists "Managers manage org user_permissions" on public.user_permissions;
create policy "Managers manage org user_permissions"
  on public.user_permissions for all to authenticated
  using (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('permissions.manage', organization_id)))
  with check (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('permissions.manage', organization_id)));

-- departments already had RLS enabled in 002; replace with per-org + founder.
alter table public.departments enable row level security;
drop policy if exists "Anon can read departments" on public.departments;
drop policy if exists "Members read org departments" on public.departments;
create policy "Members read org departments"
  on public.departments for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);
drop policy if exists "Managers manage org departments" on public.departments;
create policy "Managers manage org departments"
  on public.departments for all to authenticated
  using (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('departments.manage', organization_id)))
  with check (public.is_founder() or (organization_id = public.current_organization_id() and public.has_permission('departments.manage', organization_id)));

grant execute on function public.is_founder() to authenticated, service_role;
grant execute on function public.is_org_wide_role(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
