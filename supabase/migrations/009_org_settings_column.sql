-- =============================================================================
-- Migration 009: Add settings JSONB column to organizations table
-- =============================================================================

alter table public.organizations
  add column if not exists settings jsonb not null default '{}';

create or replace function public.get_notifications(
  p_limit integer default 50,
  p_offset integer default 0,
  p_unread_only boolean default false
)
returns setof public.notifications
language sql
stable
security definer
set search_path = public
as $$
  select * from public.notifications
  where (p_unread_only = false or read = false)
  order by created_at desc
  limit p_limit
  offset p_offset
$$;
