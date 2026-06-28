-- =============================================================================
-- Migration 024: Regulatory source slots, controlled URL edits, fetch health
-- Adds catalog_slot_id (stable per-org feed identity), optional display/type,
-- and last_fetch_* columns. Replaces UNIQUE(org, feed_url) with UNIQUE(org, slot).
-- =============================================================================

alter table public.regulatory_sources
  add column if not exists catalog_slot_id text,
  add column if not exists source_name text,
  add column if not exists source_type text,
  add column if not exists last_fetch_attempt_at timestamptz,
  add column if not exists last_fetch_success_at timestamptz,
  add column if not exists last_fetch_error text;

comment on column public.regulatory_sources.catalog_slot_id is
  'Stable catalog key (e.g. rbi_notifications); one row per org per slot';
comment on column public.regulatory_sources.source_type is
  'rss | html | pdf — mirrors catalog; used for UX';
comment on column public.regulatory_sources.last_fetch_success_at is
  'Last successful fetch (HTTP 200 + usable body for RSS/HTML probe)';
comment on column public.regulatory_sources.last_fetch_error is
  'Last fetch error message (nullable when healthy)';

-- Backfill catalog_slot_id from known catalog URLs (exact HTTPS match).
update public.regulatory_sources set catalog_slot_id = 'rbi_notifications'
  where catalog_slot_id is null and feed_url = 'https://www.rbi.org.in/notifications_rss.xml';
update public.regulatory_sources set catalog_slot_id = 'rbi_press'
  where catalog_slot_id is null and feed_url = 'https://www.rbi.org.in/pressreleases_rss.xml';
update public.regulatory_sources set catalog_slot_id = 'sebi_rss'
  where catalog_slot_id is null and feed_url = 'https://www.sebi.gov.in/sebirss.xml';
update public.regulatory_sources set catalog_slot_id = 'cert_in'
  where catalog_slot_id is null and feed_url = 'https://www.cert-in.org.in/';
update public.regulatory_sources set catalog_slot_id = 'npci'
  where catalog_slot_id is null and feed_url = 'https://www.npci.org.in/what-we-do/upi/circular';
update public.regulatory_sources set catalog_slot_id = 'uidai'
  where catalog_slot_id is null and feed_url = 'https://uidai.gov.in/en/about-uidai/legal-framework/circulars.html';
update public.regulatory_sources set catalog_slot_id = 'pmla_rbi'
  where catalog_slot_id is null and feed_url in (
    'https://www.rbi.org.in/Scripts/Notification.aspx',
    'http://www.rbi.org.in/Scripts/Notification.aspx'
  );

-- Orphans: deterministic unique slot per row (not in product catalog).
update public.regulatory_sources
  set catalog_slot_id = 'legacy_' || replace(id::text, '-', '')
  where catalog_slot_id is null;

-- If duplicate (organization_id, catalog_slot_id), keep oldest row; repoint others to legacy_*.
with ranked as (
  select id,
    row_number() over (
      partition by organization_id, catalog_slot_id order by created_at asc, id asc
    ) as rn
  from public.regulatory_sources
)
update public.regulatory_sources r
set catalog_slot_id = 'legacy_' || replace(r.id::text, '-', '')
from ranked x
where r.id = x.id and x.rn > 1;

alter table public.regulatory_sources
  alter column catalog_slot_id set not null;

-- Default source_type when null (derive from slot prefix / known patterns).
update public.regulatory_sources set source_type = 'rss'
  where source_type is null and catalog_slot_id in ('rbi_notifications', 'rbi_press', 'sebi_rss');
update public.regulatory_sources set source_type = 'html'
  where source_type is null and catalog_slot_id in ('cert_in', 'npci', 'uidai', 'pmla_rbi');
update public.regulatory_sources set source_type = 'html'
  where source_type is null and catalog_slot_id like 'legacy_%';

-- Drop old unique constraint on (organization_id, feed_url)
alter table public.regulatory_sources
  drop constraint if exists regulatory_sources_organization_id_feed_url_key;

-- One logical feed per org per catalog slot
create unique index if not exists idx_regulatory_sources_org_catalog_slot
  on public.regulatory_sources (organization_id, catalog_slot_id);

notify pgrst, 'reload schema';
