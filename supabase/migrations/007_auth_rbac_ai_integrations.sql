-- =============================================================================
-- Migration 007: Auth, RBAC, AI Review, and Integration Foundation
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

do $$ begin
  create type public.suraksha_role as enum (
    'platform_admin',
    'org_admin',
    'compliance_admin',
    'compliance_analyst',
    'security_team',
    'it_owner',
    'department_owner',
    'internal_auditor',
    'executive_viewer',
    'external_auditor'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected', 'needs_changes');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_source as enum ('wazuh', 'osquery', 'trivy', 'gitleaks', 'semgrep', 'defectdojo', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tenancy, profiles, and role assignments
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  full_name           text,
  default_persona     suraksha_role not null default 'compliance_analyst',
  current_org_id      uuid references public.organizations(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            suraksha_role not null default 'compliance_analyst',
  department      text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id, role)
);

create table if not exists public.role_permissions (
  role        suraksha_role not null,
  permission  text not null,
  created_at  timestamptz not null default now(),
  primary key (role, permission)
);

insert into public.organizations (name, slug)
values ('Suraksha Demo Bank', 'suraksha-demo-bank')
on conflict (slug) do nothing;

insert into public.role_permissions (role, permission) values
  ('platform_admin', 'admin.all'),
  ('org_admin', 'settings.manage'),
  ('org_admin', 'users.manage'),
  ('compliance_admin', 'documents.upload'),
  ('compliance_admin', 'documents.read'),
  ('compliance_admin', 'documents.delete'),
  ('compliance_admin', 'obligations.create'),
  ('compliance_admin', 'obligations.assign'),
  ('compliance_admin', 'obligations.approve'),
  ('compliance_admin', 'evidence.create'),
  ('compliance_admin', 'evidence.approve'),
  ('compliance_admin', 'reports.export'),
  ('compliance_admin', 'audit.read'),
  ('compliance_analyst', 'documents.upload'),
  ('compliance_analyst', 'documents.read'),
  ('compliance_analyst', 'obligations.create'),
  ('compliance_analyst', 'evidence.create'),
  ('compliance_analyst', 'reports.export'),
  ('security_team', 'documents.read'),
  ('security_team', 'obligations.create'),
  ('security_team', 'evidence.create'),
  ('security_team', 'security.findings.read'),
  ('it_owner', 'documents.read'),
  ('it_owner', 'evidence.create'),
  ('it_owner', 'security.findings.read'),
  ('department_owner', 'documents.read'),
  ('department_owner', 'evidence.create'),
  ('internal_auditor', 'documents.read'),
  ('internal_auditor', 'audit.read'),
  ('internal_auditor', 'reports.export'),
  ('executive_viewer', 'documents.read'),
  ('executive_viewer', 'reports.export'),
  ('external_auditor', 'documents.read'),
  ('external_auditor', 'audit.read'),
  ('external_auditor', 'reports.export')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- Core table alignment for tenancy and document lineage
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.documents add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.documents add column if not exists classification text not null default 'internal';
alter table public.documents add column if not exists checksum_sha256 text;

alter table public.obligations add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.obligations add column if not exists document_id uuid references public.documents(id) on delete cascade;
alter table public.obligations add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.obligations add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.obligations add column if not exists review_status review_status not null default 'approved';
alter table public.obligations add column if not exists source_quote text;
alter table public.obligations add column if not exists source_page integer;
alter table public.obligations add column if not exists ai_explanation text;

alter table public.evidence add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.evidence add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.evidence add column if not exists storage_path text;
alter table public.evidence add column if not exists checksum_sha256 text;
alter table public.evidence add column if not exists approval_status review_status not null default 'pending';

alter table public.map_cards add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.map_cards add column if not exists assigned_to uuid references auth.users(id) on delete set null;

alter table public.audit_trail add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.audit_trail add column if not exists actor_user_id uuid references auth.users(id) on delete set null;

alter table public.drift_comparisons add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.impact_simulations add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.readiness_scores add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.notifications add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.escalations add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_documents_org on public.documents(organization_id);
create index if not exists idx_obligations_org on public.obligations(organization_id);
create index if not exists idx_obligations_document on public.obligations(document_id);
create index if not exists idx_evidence_org on public.evidence(organization_id);
create index if not exists idx_map_cards_org on public.map_cards(organization_id);
create index if not exists idx_drift_org on public.drift_comparisons(organization_id);
create index if not exists idx_impact_org on public.impact_simulations(organization_id);

-- Backfill existing demo data into the demo organization.
update public.documents
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.obligations
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.evidence
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.map_cards
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.drift_comparisons
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.impact_simulations
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.readiness_scores
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.notifications
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

update public.escalations
set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank')
where organization_id is null;

-- ---------------------------------------------------------------------------
-- AI review, chunks, vector/RAG, and external findings
-- ---------------------------------------------------------------------------
create table if not exists public.document_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  chunk_index     integer not null,
  page_number     integer,
  section_ref     text,
  citation        text,
  content         text not null,
  embedding       vector(384),
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists public.extraction_reviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete cascade,
  obligation_id   uuid references public.obligations(id) on delete set null,
  status          review_status not null default 'pending',
  ai_confidence   numeric(5,2) not null default 0,
  source_quote    text,
  source_page     integer,
  extracted_json  jsonb not null default '{}',
  reviewer_id     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.integration_findings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  source          integration_source not null,
  external_id     text,
  title           text not null,
  description     text not null default '',
  severity        text not null default 'medium' check (severity in ('critical','high','medium','low','info')),
  asset           text,
  department      text,
  obligation_id   uuid references public.obligations(id) on delete set null,
  evidence_id     uuid references public.evidence(id) on delete set null,
  raw_payload     jsonb not null default '{}',
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  status          text not null default 'open' check (status in ('open','accepted','false_positive','resolved')),
  unique (source, external_id)
);

create table if not exists public.audit_exports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  export_type     text not null default 'audit_pack',
  filters         jsonb not null default '{}',
  status          text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  storage_path    text,
  checksum_sha256 text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_document_chunks_doc on public.document_chunks(document_id);
create index if not exists idx_extraction_reviews_doc on public.extraction_reviews(document_id);
create index if not exists idx_integration_findings_org on public.integration_findings(organization_id);
create index if not exists idx_integration_findings_source on public.integration_findings(source);

-- ---------------------------------------------------------------------------
-- Authorization helpers and RLS
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid,
    (select current_org_id from public.profiles where id = auth.uid())
  )
$$;

create or replace function public.has_permission(permission_name text, org_id uuid default public.current_organization_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.role_permissions rp on rp.role = om.role
    where om.user_id = auth.uid()
      and om.organization_id = org_id
      and (om.expires_at is null or om.expires_at > now())
      and (rp.permission = permission_name or rp.permission = 'admin.all')
  )
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.role_permissions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.extraction_reviews enable row level security;
alter table public.integration_findings enable row level security;
alter table public.audit_exports enable row level security;

drop policy if exists "members can read their organizations" on public.organizations;
create policy "members can read their organizations"
  on public.organizations for select to authenticated
  using (exists (
    select 1 from public.organization_members om
    where om.organization_id = organizations.id and om.user_id = auth.uid()
  ));

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
  on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members can read org membership" on public.organization_members;
create policy "members can read org membership"
  on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.manage', organization_id));

drop policy if exists "authenticated can read role permissions" on public.role_permissions;
create policy "authenticated can read role permissions"
  on public.role_permissions for select to authenticated using (true);

-- Replace permissive demo policies where possible. Service role keeps bypassing RLS.
drop policy if exists "Anon can insert obligations" on public.obligations;
drop policy if exists "Anon can update obligations" on public.obligations;
drop policy if exists "Anon can insert documents" on public.documents;
drop policy if exists "Anon can update documents" on public.documents;
drop policy if exists "Anon can insert audit_trail" on public.audit_trail;
drop policy if exists "Anon can insert evidence" on public.evidence;
drop policy if exists "Anon can update evidence" on public.evidence;
drop policy if exists "Anon can insert map_cards" on public.map_cards;
drop policy if exists "Anon can update map_cards" on public.map_cards;
drop policy if exists "Authenticated users can read obligations" on public.obligations;
drop policy if exists "Authenticated users can insert obligations" on public.obligations;
drop policy if exists "Authenticated users can update obligations" on public.obligations;
drop policy if exists "Authenticated users can read documents" on public.documents;
drop policy if exists "Authenticated users can insert documents" on public.documents;
drop policy if exists "Authenticated users can update documents" on public.documents;
drop policy if exists "Authenticated users can read audit trail" on public.audit_trail;
drop policy if exists "Authenticated users can insert audit entries" on public.audit_trail;
drop policy if exists "Authenticated users can read evidence" on public.evidence;
drop policy if exists "Authenticated users can insert evidence" on public.evidence;
drop policy if exists "Authenticated full access drift_comparisons" on public.drift_comparisons;
drop policy if exists "Anon can insert compliance_trends" on public.compliance_trends;
drop policy if exists "Anon can read compliance_trends" on public.compliance_trends;
drop policy if exists "Anon can read departments" on public.departments;
drop policy if exists "Anon can insert drift_comparisons" on public.drift_comparisons;
drop policy if exists "Anon can read drift_comparisons" on public.drift_comparisons;
drop policy if exists "Anon can insert escalations" on public.escalations;
drop policy if exists "Anon can read escalations" on public.escalations;
drop policy if exists "Anon can update escalations" on public.escalations;
drop policy if exists "Anon can insert graph_relationships" on public.graph_relationships;
drop policy if exists "Anon can read graph_relationships" on public.graph_relationships;
drop policy if exists "Anon can insert impact_simulations" on public.impact_simulations;
drop policy if exists "Anon can read impact_simulations" on public.impact_simulations;
drop policy if exists "Anon can insert notifications" on public.notifications;
drop policy if exists "Anon can read notifications" on public.notifications;
drop policy if exists "Anon can update notifications" on public.notifications;
drop policy if exists "Anon can insert readiness_scores" on public.readiness_scores;
drop policy if exists "Anon can read readiness_scores" on public.readiness_scores;
drop policy if exists "Anon can update readiness_scores" on public.readiness_scores;
drop policy if exists "Anon can insert regulatory_versions" on public.regulatory_versions;
drop policy if exists "Anon can read regulatory_versions" on public.regulatory_versions;
drop policy if exists "Anon can insert risk_scores" on public.risk_scores;
drop policy if exists "Anon can read risk_scores" on public.risk_scores;
drop policy if exists "Anon can update risk_scores" on public.risk_scores;
drop policy if exists "Anon can delete compliance-documents" on storage.objects;
drop policy if exists "Anon can read compliance-documents" on storage.objects;
drop policy if exists "Anon can update compliance-documents" on storage.objects;
drop policy if exists "Anon can upload compliance-documents" on storage.objects;

drop policy if exists "Authenticated can read compliance-documents" on storage.objects;
create policy "Authenticated can read compliance-documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'compliance-documents');

drop policy if exists "Authenticated can read org documents" on public.documents;
create policy "Authenticated can read org documents"
  on public.documents for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('documents.read', organization_id));

drop policy if exists "Authenticated can insert org documents" on public.documents;
create policy "Authenticated can insert org documents"
  on public.documents for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.has_permission('documents.upload', organization_id));

drop policy if exists "Authenticated can delete org documents" on public.documents;
create policy "Authenticated can delete org documents"
  on public.documents for delete to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('documents.delete', organization_id));

drop policy if exists "Authenticated can read org obligations" on public.obligations;
create policy "Authenticated can read org obligations"
  on public.obligations for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('documents.read', organization_id));

drop policy if exists "Authenticated can insert org obligations" on public.obligations;
create policy "Authenticated can insert org obligations"
  on public.obligations for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.has_permission('obligations.create', organization_id));

drop policy if exists "Authenticated can update org obligations" on public.obligations;
create policy "Authenticated can update org obligations"
  on public.obligations for update to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('obligations.assign', organization_id))
  with check (organization_id = public.current_organization_id());

drop policy if exists "Authenticated can read org evidence" on public.evidence;
create policy "Authenticated can read org evidence"
  on public.evidence for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('documents.read', organization_id));

drop policy if exists "Authenticated can insert org evidence" on public.evidence;
create policy "Authenticated can insert org evidence"
  on public.evidence for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.has_permission('evidence.create', organization_id));

drop policy if exists "Authenticated can read AI chunks" on public.document_chunks;
create policy "Authenticated can read AI chunks"
  on public.document_chunks for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('documents.read', organization_id));

drop policy if exists "Authenticated can manage AI reviews" on public.extraction_reviews;
create policy "Authenticated can manage AI reviews"
  on public.extraction_reviews for all to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('obligations.approve', organization_id))
  with check (organization_id = public.current_organization_id());

drop policy if exists "Security can read integration findings" on public.integration_findings;
create policy "Security can read integration findings"
  on public.integration_findings for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('security.findings.read', organization_id));

drop policy if exists "Compliance can write integration findings" on public.integration_findings;
create policy "Compliance can write integration findings"
  on public.integration_findings for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.has_permission('security.findings.read', organization_id));

drop policy if exists "Auditors can read exports" on public.audit_exports;
create policy "Auditors can read exports"
  on public.audit_exports for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('reports.export', organization_id));

drop policy if exists "Users can request exports" on public.audit_exports;
create policy "Users can request exports"
  on public.audit_exports for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.has_permission('reports.export', organization_id));

-- Security-definer RPCs stay available only to signed-in users and server-side
-- service role callers. Anonymous dashboard access was for the hackathon demo.
revoke execute on function public.get_analytics_overview() from public, anon;
revoke execute on function public.get_dashboard_kpis() from public, anon;
revoke execute on function public.get_escalations() from public, anon;
revoke execute on function public.get_notifications(integer, integer, boolean) from public, anon;
revoke execute on function public.get_recent_activity(integer) from public, anon;
revoke execute on function public.has_permission(text, uuid) from public, anon;
revoke execute on function public.increment_evidence_count(uuid) from public, anon;

grant execute on function public.get_analytics_overview() to authenticated, service_role;
grant execute on function public.get_dashboard_kpis() to authenticated, service_role;
grant execute on function public.get_escalations() to authenticated, service_role;
grant execute on function public.get_notifications(integer, integer, boolean) to authenticated, service_role;
grant execute on function public.get_recent_activity(integer) to authenticated, service_role;
grant execute on function public.has_permission(text, uuid) to authenticated, service_role;
grant execute on function public.increment_evidence_count(uuid) to authenticated, service_role;
