-- Obligation fingerprint dedupe + regulatory change duplicate PDF status
-- (agent-service: skip inserts when fingerprint exists; mark feed rows duplicate)

alter table public.obligations
  add column if not exists obligation_fingerprint text;

create index if not exists idx_obligations_org_fingerprint
  on public.obligations (organization_id, obligation_fingerprint)
  where obligation_fingerprint is not null;

alter table public.regulatory_changes
  drop constraint if exists regulatory_changes_status_check;

alter table public.regulatory_changes
  add constraint regulatory_changes_status_check
  check (status in ('detected','processing','mapped','error','duplicate'));

comment on column public.obligations.obligation_fingerprint is
  'SHA-256 hex of normalized obligation identity for org-level dedupe (agent pipeline)';
