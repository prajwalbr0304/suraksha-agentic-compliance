-- =============================================================================
-- Suraksha Compliance OS — Supabase Database Schema
-- Run this in the Supabase SQL editor or via the Supabase CLI:
--   supabase db push
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type obligation_status as enum (
    'compliant', 'in_progress', 'at_risk', 'overdue', 'pending_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type obligation_priority as enum ('critical', 'high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_status as enum ('queued', 'processing', 'processed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum (
    'obligation_created', 'obligation_updated', 'obligation_closed',
    'document_uploaded', 'document_processed',
    'risk_flagged', 'evidence_added', 'review_completed', 'alert_generated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_trend as enum ('up', 'down', 'stable');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.obligations (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  title             text not null,
  description       text not null default '',
  regulation        text not null,
  jurisdiction      text not null,
  department        text not null,
  owner             text not null,
  status            obligation_status not null default 'pending_review',
  priority          obligation_priority not null default 'medium',
  due_date          date not null,
  confidence_score  smallint not null default 0 check (confidence_score between 0 and 100),
  evidence_count    smallint not null default 0,
  tags              text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.documents (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  size                  bigint not null,
  mime_type             text not null,
  storage_path          text not null unique,
  status                document_status not null default 'queued',
  obligations_extracted smallint not null default 0,
  confidence_score      smallint not null default 0 check (confidence_score between 0 and 100),
  uploaded_by           text not null,
  uploaded_at           timestamptz not null default now(),
  processed_at          timestamptz,
  metadata              jsonb not null default '{}'
);

create table if not exists public.audit_trail (
  id           uuid primary key default gen_random_uuid(),
  action       audit_action not null,
  actor        text not null,
  actor_role   text not null default 'Compliance Officer',
  target       text not null,
  target_id    uuid,
  details      text not null,
  severity     text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  ip_address   inet,
  user_agent   text,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table if not exists public.risk_scores (
  id                  uuid primary key default gen_random_uuid(),
  department          text not null unique,
  score               smallint not null check (score between 0 and 100),
  trend               risk_trend not null default 'stable',
  overdue_count       smallint not null default 0,
  total_obligations   smallint not null default 0,
  updated_at          timestamptz not null default now()
);

create table if not exists public.compliance_trends (
  id           uuid primary key default gen_random_uuid(),
  month        text not null,
  year         smallint not null,
  score        smallint not null check (score between 0 and 100),
  obligations  smallint not null default 0,
  resolved     smallint not null default 0,
  recorded_at  timestamptz not null default now(),
  unique (month, year)
);

create table if not exists public.evidence (
  id              uuid primary key default gen_random_uuid(),
  obligation_id   uuid not null references public.obligations(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete set null,
  title           text not null,
  description     text not null default '',
  collected_at    date not null default current_date,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_obligations_status    on public.obligations(status);
create index if not exists idx_obligations_department on public.obligations(department);
create index if not exists idx_obligations_due_date  on public.obligations(due_date);
create index if not exists idx_audit_created_at      on public.audit_trail(created_at desc);
create index if not exists idx_documents_uploaded_at on public.documents(uploaded_at desc);
create index if not exists idx_evidence_obligation   on public.evidence(obligation_id);

-- ---------------------------------------------------------------------------
-- Auto-update `updated_at` trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists obligations_updated_at on public.obligations;
create trigger obligations_updated_at
  before update on public.obligations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- Enable RLS on all tables. Adjust policies for your auth model.
-- ---------------------------------------------------------------------------
alter table public.obligations       enable row level security;
alter table public.documents         enable row level security;
alter table public.audit_trail       enable row level security;
alter table public.risk_scores       enable row level security;
alter table public.compliance_trends enable row level security;
alter table public.evidence          enable row level security;

-- Default policies: allow authenticated users to read all, write their own.
-- Replace with fine-grained org/role policies as needed.

create policy "Authenticated users can read obligations"
  on public.obligations for select
  to authenticated using (true);

create policy "Authenticated users can insert obligations"
  on public.obligations for insert
  to authenticated with check (true);

create policy "Authenticated users can update obligations"
  on public.obligations for update
  to authenticated using (true);

create policy "Authenticated users can read documents"
  on public.documents for select
  to authenticated using (true);

create policy "Authenticated users can insert documents"
  on public.documents for insert
  to authenticated with check (true);

create policy "Authenticated users can update documents"
  on public.documents for update
  to authenticated using (true);

create policy "Authenticated users can read audit trail"
  on public.audit_trail for select
  to authenticated using (true);

create policy "Authenticated users can insert audit entries"
  on public.audit_trail for insert
  to authenticated with check (true);

create policy "Authenticated users can read risk scores"
  on public.risk_scores for select
  to authenticated using (true);

create policy "Authenticated users can read compliance trends"
  on public.compliance_trends for select
  to authenticated using (true);

create policy "Authenticated users can read evidence"
  on public.evidence for select
  to authenticated using (true);

create policy "Authenticated users can insert evidence"
  on public.evidence for insert
  to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Storage bucket (run once via Supabase dashboard or CLI)
-- ---------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public)
-- values ('compliance-documents', 'compliance-documents', false)
-- on conflict (id) do nothing;
