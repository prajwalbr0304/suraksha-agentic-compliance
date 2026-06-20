-- =============================================================================
-- Migration 008: Department and Assignment ABAC RLS Hardening
-- =============================================================================

create or replace function public.current_user_role(org_id uuid default public.current_organization_id())
returns public.suraksha_role
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.organization_id = org_id
    and (om.expires_at is null or om.expires_at > now())
  order by case om.role
    when 'platform_admin' then 1
    when 'org_admin' then 2
    when 'compliance_admin' then 3
    when 'compliance_analyst' then 4
    when 'internal_auditor' then 5
    when 'executive_viewer' then 6
    when 'external_auditor' then 7
    when 'security_team' then 8
    when 'it_owner' then 9
    when 'department_owner' then 10
    else 99
  end
  limit 1
$$;

create or replace function public.current_user_department(org_id uuid default public.current_organization_id())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select om.department
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.organization_id = org_id
    and (om.expires_at is null or om.expires_at > now())
  order by om.created_at asc
  limit 1
$$;

create or replace function public.is_org_wide_role(org_id uuid default public.current_organization_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role(org_id) in (
    'platform_admin',
    'org_admin',
    'compliance_admin',
    'compliance_analyst',
    'internal_auditor',
    'executive_viewer',
    'external_auditor'
  )
$$;

create or replace function public.can_access_department(row_department text, org_id uuid default public.current_organization_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_wide_role(org_id)
    or row_department is null
    or lower(row_department) = lower(public.current_user_department(org_id))
$$;

create or replace function public.can_access_assigned_row(
  row_department text,
  row_assigned_to uuid,
  row_created_by uuid,
  org_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_department(row_department, org_id)
    or row_assigned_to = auth.uid()
    or row_created_by = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Replace broad org-only policies with org + department/assignment ABAC.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated can read org obligations" on public.obligations;
create policy "Authenticated can read org obligations"
  on public.obligations for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('documents.read', organization_id)
    and public.can_access_assigned_row(department, assigned_to, created_by, organization_id)
  );

drop policy if exists "Authenticated can update org obligations" on public.obligations;
create policy "Authenticated can update org obligations"
  on public.obligations for update to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('obligations.assign', organization_id)
    and public.can_access_assigned_row(department, assigned_to, created_by, organization_id)
  )
  with check (
    organization_id = public.current_organization_id()
    and public.can_access_assigned_row(department, assigned_to, created_by, organization_id)
  );

drop policy if exists "Authenticated can read org evidence" on public.evidence;
create policy "Authenticated can read org evidence"
  on public.evidence for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('documents.read', organization_id)
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.obligations o
        where o.id = evidence.obligation_id
          and o.organization_id = evidence.organization_id
          and public.can_access_assigned_row(o.department, o.assigned_to, o.created_by, o.organization_id)
      )
    )
  );

drop policy if exists "Authenticated can insert org evidence" on public.evidence;
create policy "Authenticated can insert org evidence"
  on public.evidence for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.has_permission('evidence.create', organization_id)
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.obligations o
        where o.id = evidence.obligation_id
          and o.organization_id = evidence.organization_id
          and public.can_access_assigned_row(o.department, o.assigned_to, o.created_by, o.organization_id)
      )
    )
  );

drop policy if exists "Authenticated can read AI chunks" on public.document_chunks;
create policy "Authenticated can read AI chunks"
  on public.document_chunks for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('documents.read', organization_id)
  );

drop policy if exists "Authenticated can manage AI reviews" on public.extraction_reviews;
create policy "Authenticated can manage AI reviews"
  on public.extraction_reviews for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('obligations.approve', organization_id)
    and (
      reviewer_id = auth.uid()
      or exists (
        select 1 from public.obligations o
        where o.id = extraction_reviews.obligation_id
          and o.organization_id = extraction_reviews.organization_id
          and public.can_access_assigned_row(o.department, o.assigned_to, o.created_by, o.organization_id)
      )
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.has_permission('obligations.approve', organization_id)
  );

drop policy if exists "Security can read integration findings" on public.integration_findings;
create policy "Security can read integration findings"
  on public.integration_findings for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('security.findings.read', organization_id)
    and public.can_access_department(department, organization_id)
  );

drop policy if exists "Compliance can write integration findings" on public.integration_findings;
create policy "Compliance can write integration findings"
  on public.integration_findings for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.has_permission('security.findings.read', organization_id)
    and public.can_access_department(department, organization_id)
  );

drop policy if exists "Authenticated can read org map cards" on public.map_cards;
create policy "Authenticated can read org map cards"
  on public.map_cards for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('documents.read', organization_id)
    and public.can_access_assigned_row(department, assigned_to, null, organization_id)
  );

drop policy if exists "Authenticated can update org map cards" on public.map_cards;
create policy "Authenticated can update org map cards"
  on public.map_cards for update to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('obligations.assign', organization_id)
    and public.can_access_assigned_row(department, assigned_to, null, organization_id)
  )
  with check (
    organization_id = public.current_organization_id()
    and public.can_access_assigned_row(department, assigned_to, null, organization_id)
  );

drop policy if exists "Authenticated can delete org map cards" on public.map_cards;
create policy "Authenticated can delete org map cards"
  on public.map_cards for delete to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_permission('obligations.assign', organization_id)
    and public.can_access_assigned_row(department, assigned_to, null, organization_id)
  );

grant execute on function public.current_user_role(uuid) to authenticated, service_role;
grant execute on function public.current_user_department(uuid) to authenticated, service_role;
grant execute on function public.is_org_wide_role(uuid) to authenticated, service_role;
grant execute on function public.can_access_department(text, uuid) to authenticated, service_role;
grant execute on function public.can_access_assigned_row(text, uuid, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
