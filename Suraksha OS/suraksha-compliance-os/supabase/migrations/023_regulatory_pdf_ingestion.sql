-- =============================================================================
-- Migration 023: Regulatory PDF ingestion trace (agent autonomous PDF path)
-- =============================================================================

alter table public.regulatory_changes
  add column if not exists resolved_pdf_url text;

alter table public.regulatory_changes
  add column if not exists pdf_storage_path text;

alter table public.regulatory_changes
  add column if not exists ingestion_error text;

comment on column public.regulatory_changes.resolved_pdf_url is 'Direct PDF URL resolved from RSS/HTML notification link';
comment on column public.regulatory_changes.pdf_storage_path is 'Path in compliance-documents bucket after agent upload';
comment on column public.regulatory_changes.ingestion_error is 'Last PDF download/storage/parse error (nullable)';

notify pgrst, 'reload schema';
