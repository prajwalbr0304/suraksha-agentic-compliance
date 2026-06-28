-- =============================================================================
-- Migration 014: Enterprise tenancy structures
-- founders, per-org departments, teams, user_permissions, org status/metadata
-- =============================================================================

-- ── Founders (global platform owners) ────────────────────────────────────────
create table if not exists public.founders (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ── Organizations: lifecycle + metadata ──────────────────────────────────────
alter table public.organizations add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended', 'archived'));
alter table public.organizations add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.organizations add column if not exists region text;
alter table public.organizations add column if not exists license_no text;
alter table public.organizations add column if not exists manager_email text;

-- ── Departments become per-organization ──────────────────────────────────────
alter table public.departments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.departments add column if not exists head_user_id uuid references auth.users(id) on delete set null;

-- Backfill existing global departments to the demo org so nothing is orphaned.
update public.departments d
  set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank' limit 1)
  where d.organization_id is null;

-- Replace the global unique(name) with a per-org unique(organization_id, name).
do $$
declare
  cname text;
begin
  select tc.constraint_name into cname
  from information_schema.table_constraints tc
  where tc.table_schema = 'public' and tc.table_name = 'departments'
    and tc.constraint_type = 'UNIQUE';
  if cname is not null then
    execute format('alter table public.departments drop constraint %I', cname);
  end if;
exception when others then null;
end $$;

create unique index if not exists uq_departments_org_name on public.departments(organization_id, name);
create index if not exists idx_departments_org on public.departments(organization_id);

-- ── Teams (belong to a department within an organization) ─────────────────────
create table if not exists public.teams (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id   uuid references public.departments(id) on delete set null,
  name            text not null,
  lead_user_id    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists idx_teams_org on public.teams(organization_id);

-- ── Organization members: team + lifecycle ───────────────────────────────────
alter table public.organization_members add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.organization_members add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended'));

-- ── Per-user permission grants (Manager can grant beyond role) ────────────────
create table if not exists public.user_permissions (
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission      text not null,
  granted_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (user_id, organization_id, permission)
);
create index if not exists idx_user_permissions_user on public.user_permissions(user_id, organization_id);

-- ── Mark backfilled demo org as created by platform ───────────────────────────
update public.organizations set status = 'active' where status is null;
