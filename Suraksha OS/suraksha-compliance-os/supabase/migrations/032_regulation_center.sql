-- =============================================================================
-- Migration 032: Regulation Center — lifecycle, governance, processing log,
-- source fetch windows, PDF metadata, queue fields, document_chunks link.
-- =============================================================================

-- ── regulatory_sources: governance + fetch windows ─────────────────────────
alter table public.regulatory_sources
  add column if not exists fetch_interval_minutes integer not null default 360,
  add column if not exists lookback_days integer not null default 7,
  add column if not exists auto_download_pdf boolean not null default true,
  add column if not exists auto_process boolean not null default false,
  add column if not exists approval_required boolean not null default false,
  add column if not exists fetch_watermark_published_at timestamptz,
  add column if not exists fetch_failure_count integer not null default 0;

comment on column public.regulatory_sources.fetch_interval_minutes is
  'Minimum minutes between scheduled scans for this slot (APScheduler / agent tick).';
comment on column public.regulatory_sources.lookback_days is
  'Ignore feed items older than this many days when scanning (best-effort).';
comment on column public.regulatory_sources.fetch_watermark_published_at is
  'Latest feed item published_at processed for this source (watermark for incremental fetch).';

-- ── regulatory_changes: Regulation Center lifecycle (source of truth) ───────
alter table public.regulatory_changes
  add column if not exists lifecycle_status text,
  add column if not exists enabled boolean not null default true,
  add column if not exists paused boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists pdf_checksum_sha256 text,
  add column if not exists pdf_stage text default 'none',
  add column if not exists queue_position integer,
  add column if not exists queued_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_order bigint,
  add column if not exists tags text[] not null default '{}',
  add column if not exists category text,
  add column if not exists executive_summary text,
  add column if not exists version integer not null default 1,
  add column if not exists supersedes_id uuid references public.regulatory_changes (id) on delete set null,
  add column if not exists logical_circular_key text,
  add column if not exists duplicate_of_id uuid references public.regulatory_changes (id) on delete set null,
  add column if not exists manual_pdf_storage_path text,
  add column if not exists retry_count integer not null default 0;

-- Backfill lifecycle from legacy status (before NOT NULL + CHECK)
update public.regulatory_changes
set lifecycle_status = case
  when status = 'mapped' then 'completed'
  when status = 'error' then 'failed_processing'
  when status = 'duplicate' then 'duplicate'
  when status = 'processing' then 'processing'
  when status = 'detected' then 'new'
  else 'new'
end
where lifecycle_status is null;

update public.regulatory_changes set pdf_stage = 'none' where pdf_stage is null;

alter table public.regulatory_changes
  alter column lifecycle_status set default 'new',
  alter column lifecycle_status set not null;

alter table public.regulatory_changes
  alter column pdf_stage set default 'none',
  alter column pdf_stage set not null;

alter table public.regulatory_changes
  drop constraint if exists regulatory_changes_lifecycle_status_check;

alter table public.regulatory_changes
  add constraint regulatory_changes_lifecycle_status_check
  check (
    lifecycle_status in (
      'new',
      'awaiting_approval',
      'rejected',
      'approved',
      'queued',
      'processing',
      'completed',
      'failed_ingest',
      'failed_processing',
      'duplicate',
      'archived'
    )
  );

alter table public.regulatory_changes
  drop constraint if exists regulatory_changes_pdf_stage_check;

alter table public.regulatory_changes
  add constraint regulatory_changes_pdf_stage_check
  check (pdf_stage in ('none', 'downloaded', 'ready', 'ocr_complete', 'chunked', 'embedded'));

create index if not exists idx_reg_changes_org_lifecycle
  on public.regulatory_changes (organization_id, lifecycle_status);

create index if not exists idx_reg_changes_org_pdf_checksum
  on public.regulatory_changes (organization_id, pdf_checksum_sha256)
  where pdf_checksum_sha256 is not null;

create index if not exists idx_reg_changes_queue
  on public.regulatory_changes (organization_id, lifecycle_status, queue_position)
  where lifecycle_status = 'queued' and enabled = true and paused = false;

-- ── Append-only processing log ──────────────────────────────────────────────
create table if not exists public.regulation_processing_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  regulatory_change_id uuid not null references public.regulatory_changes (id) on delete cascade,
  stage text not null,
  status text not null,
  message text,
  agent_name text,
  payload jsonb not null default '{}',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists idx_reg_proc_log_change
  on public.regulation_processing_log (regulatory_change_id, started_at desc);

alter table public.regulation_processing_log enable row level security;

drop policy if exists "Members read regulation_processing_log" on public.regulation_processing_log;
create policy "Members read regulation_processing_log"
  on public.regulation_processing_log for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id());

-- ── document_chunks: optional link back to regulatory change ────────────────
alter table public.document_chunks
  add column if not exists regulatory_change_id uuid references public.regulatory_changes (id) on delete set null;

create index if not exists idx_document_chunks_reg_change
  on public.document_chunks (regulatory_change_id)
  where regulatory_change_id is not null;

notify pgrst, 'reload schema';
