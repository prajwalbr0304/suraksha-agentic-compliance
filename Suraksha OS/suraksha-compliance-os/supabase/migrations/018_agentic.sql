-- =============================================================================
-- Migration 018: Agentic regulatory intelligence (ADK)
-- regulatory_sources, regulatory_changes, agent_runs, agent_events + markers
-- =============================================================================

-- Per-bank regulatory feed subscriptions
create table if not exists public.regulatory_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  regulator       text not null,                 -- RBI | SEBI | PMLA | ...
  feed_url        text not null,
  enabled         boolean not null default true,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, feed_url)
);
create index if not exists idx_reg_sources_org on public.regulatory_sources(organization_id);

-- Detected regulatory changes (dedupe by org + external_ref)
create table if not exists public.regulatory_changes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id       uuid references public.regulatory_sources(id) on delete set null,
  regulator       text,
  external_ref    text not null,
  title           text not null,
  url             text,
  published_at    timestamptz,
  raw_text        text,
  status          text not null default 'detected'
                    check (status in ('detected','processing','mapped','error')),
  document_id     uuid references public.documents(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, external_ref)
);
create index if not exists idx_reg_changes_org on public.regulatory_changes(organization_id);
create index if not exists idx_reg_changes_status on public.regulatory_changes(status);

-- Agent run + event observability
create table if not exists public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  agent           text not null,                 -- regwatcher | pipeline | validator
  trigger         text not null default 'manual', -- manual | scheduled
  status          text not null default 'running'
                    check (status in ('running','completed','failed')),
  summary         text,
  stats           jsonb not null default '{}',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index if not exists idx_agent_runs_org on public.agent_runs(organization_id);

create table if not exists public.agent_events (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid references public.agent_runs(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  type            text not null,
  message         text,
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists idx_agent_events_run on public.agent_events(run_id);

-- Provenance markers on existing tables
alter table public.obligations add column if not exists source text not null default 'manual';
alter table public.map_cards   add column if not exists generated_by text not null default 'manual';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.regulatory_sources enable row level security;
alter table public.regulatory_changes enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;

drop policy if exists "Members read reg sources" on public.regulatory_sources;
create policy "Members read reg sources" on public.regulatory_sources for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());

drop policy if exists "Members read reg changes" on public.regulatory_changes;
create policy "Members read reg changes" on public.regulatory_changes for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());

drop policy if exists "Members read agent runs" on public.agent_runs;
create policy "Members read agent runs" on public.agent_runs for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());

drop policy if exists "Members read agent events" on public.agent_events;
create policy "Members read agent events" on public.agent_events for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());

notify pgrst, 'reload schema';
