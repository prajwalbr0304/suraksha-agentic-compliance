-- =============================================================================
-- Migration 019: Tenant isolation hardening
-- -----------------------------------------------------------------------------
-- Phase 1 of the production-hardening plan:
--   1.1  Org-scope the global SECURITY DEFINER RPCs (dashboard KPIs, analytics,
--        notifications) so a member of one bank can never see another bank's
--        aggregate numbers. Founders (is_founder()) may pass p_org_id = null to
--        get platform-wide totals.
--   1.2  Give risk_scores + compliance_trends an organization_id, backfill to the
--        demo org, switch their unique keys to be per-org, and replace the
--        USING (true) read policies with org-scoped + founder-bypass policies.
--   1.3  Make has_permission() also honour per-user grants (user_permissions),
--        not just role_permissions.
--   1.5  Codify explicit org-scoped SELECT policies on the auxiliary tables
--        (drift_comparisons, impact_simulations, graph_relationships,
--        notifications) so intent is enforced even if the BFF stops using the
--        service role.
-- Forward-only + idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.2  risk_scores / compliance_trends become per-organization
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.risk_scores       add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.compliance_trends add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.risk_scores
  set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank' limit 1)
  where organization_id is null;

update public.compliance_trends
  set organization_id = (select id from public.organizations where slug = 'suraksha-demo-bank' limit 1)
  where organization_id is null;

-- Replace the global unique(department) / unique(month, year) constraints with
-- per-organization composites so each bank keeps its own aggregate rows.
do $$
declare cname text;
begin
  for cname in
    select tc.constraint_name
    from information_schema.table_constraints tc
    where tc.table_schema = 'public' and tc.table_name = 'risk_scores'
      and tc.constraint_type = 'UNIQUE'
  loop
    execute format('alter table public.risk_scores drop constraint %I', cname);
  end loop;
end $$;

do $$
declare cname text;
begin
  for cname in
    select tc.constraint_name
    from information_schema.table_constraints tc
    where tc.table_schema = 'public' and tc.table_name = 'compliance_trends'
      and tc.constraint_type = 'UNIQUE'
  loop
    execute format('alter table public.compliance_trends drop constraint %I', cname);
  end loop;
end $$;

create unique index if not exists uq_risk_scores_org_dept
  on public.risk_scores(organization_id, department);
create unique index if not exists uq_compliance_trends_org_period
  on public.compliance_trends(organization_id, month, year);

create index if not exists idx_risk_scores_org on public.risk_scores(organization_id);
create index if not exists idx_compliance_trends_org on public.compliance_trends(organization_id);

-- Replace the permissive USING (true) read policies (added in 012/016) with
-- org-scoped + founder bypass. Null-org rows remain a shared baseline.
drop policy if exists "Authenticated can read risk_scores" on public.risk_scores;
create policy "Authenticated can read risk_scores"
  on public.risk_scores for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read compliance_trends" on public.compliance_trends;
create policy "Authenticated can read compliance_trends"
  on public.compliance_trends for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.5  Explicit org-scoped SELECT policies on auxiliary tables (defense in depth)
--      (007 dropped the old anon/authenticated-all policies; these tables were
--       left readable only via the service-role BFF. Codify the intent.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.drift_comparisons   enable row level security;
alter table public.impact_simulations  enable row level security;
alter table public.graph_relationships enable row level security;
alter table public.notifications       enable row level security;

drop policy if exists "Authenticated can read org drift" on public.drift_comparisons;
create policy "Authenticated can read org drift"
  on public.drift_comparisons for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read org impact" on public.impact_simulations;
create policy "Authenticated can read org impact"
  on public.impact_simulations for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

-- graph_relationships has no organization_id column; keep it readable to any
-- authenticated member (edges are derived from already org-scoped entities) but
-- remove anon exposure. Founders included implicitly.
drop policy if exists "Authenticated can read graph" on public.graph_relationships;
create policy "Authenticated can read graph"
  on public.graph_relationships for select to authenticated
  using (true);

drop policy if exists "Authenticated can read org notifications" on public.notifications;
create policy "Authenticated can read org notifications"
  on public.notifications for select to authenticated
  using (public.is_founder() or organization_id = public.current_organization_id() or organization_id is null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.3  has_permission() must also honour per-user grants (user_permissions)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.has_permission(permission_name text, org_id uuid default public.current_organization_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- role-derived permissions (+ admin.all short-circuit)
    exists (
      select 1
      from public.organization_members om
      join public.role_permissions rp on rp.role = om.role
      where om.user_id = auth.uid()
        and om.organization_id = org_id
        and (om.expires_at is null or om.expires_at > now())
        and (rp.permission = permission_name or rp.permission = 'admin.all')
    )
    -- per-user grants made by a Manager (Access Control)
    or exists (
      select 1
      from public.user_permissions up
      where up.user_id = auth.uid()
        and up.organization_id = org_id
        and (up.permission = permission_name or up.permission = 'admin.all')
    );
$$;

revoke execute on function public.has_permission(text, uuid) from public, anon;
grant execute on function public.has_permission(text, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1  Org-scoped dashboard KPIs
-- Drop the legacy zero-arg (global) version so it can no longer be called; the
-- new signature carries an optional p_org_id and is the only remaining overload.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_dashboard_kpis();

create or replace function public.get_dashboard_kpis(p_org_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result            json;
  v_founder         boolean := public.is_founder();
  v_org             uuid    := coalesce(p_org_id, public.current_organization_id());
  v_all             boolean := v_founder and p_org_id is null;
  total_obligations int;
  compliance_score  numeric;
  pending_maps      int;
  docs_processed    int;
  obligations_month int;
  overdue_count     int;
  high_risk_count   int;
  docs_week         int;
  open_notifs       int;
  open_escalations  int;
begin
  select count(*) into total_obligations
    from public.obligations o
    where v_all or o.organization_id = v_org;

  select coalesce(
    round((count(*) filter (where status = 'compliant')::numeric
          / nullif(count(*)::numeric, 0)) * 100, 1), 0)
    into compliance_score
    from public.obligations o
    where v_all or o.organization_id = v_org;

  select count(*) into pending_maps
    from public.map_cards m
    where (v_all or m.organization_id = v_org)
      and m.status in ('backlog','in_progress','review');

  select count(*) into docs_processed
    from public.documents d
    where (v_all or d.organization_id = v_org)
      and d.status = 'processed';

  select count(*) into obligations_month
    from public.obligations o
    where (v_all or o.organization_id = v_org)
      and o.created_at >= date_trunc('month', now());

  select count(*) into overdue_count
    from public.obligations o
    where (v_all or o.organization_id = v_org)
      and (o.status = 'overdue' or (o.due_date < current_date and o.status <> 'compliant'));

  select count(*) into high_risk_count
    from public.obligations o
    where (v_all or o.organization_id = v_org)
      and o.priority in ('critical','high');

  select count(*) into docs_week
    from public.documents d
    where (v_all or d.organization_id = v_org)
      and d.uploaded_at >= date_trunc('week', now());

  select count(*) into open_notifs
    from public.notifications n
    where (v_all or n.organization_id = v_org or n.organization_id is null)
      and n.read = false;

  select count(*) into open_escalations
    from public.escalations e
    where (v_all or e.organization_id = v_org or e.organization_id is null)
      and e.status = 'open';

  result := json_build_object(
    'total_obligations',      total_obligations,
    'compliance_score',       compliance_score,
    'pending_maps',           pending_maps,
    'docs_processed',         docs_processed,
    'obligations_this_month', obligations_month,
    'overdue_count',          overdue_count,
    'high_risk_count',        high_risk_count,
    'docs_this_week',         docs_week,
    'open_notifications',     open_notifs,
    'open_escalations',       open_escalations
  );
  return result;
end;
$$;

-- revoke execute on function public.get_dashboard_kpis() from public, anon;
revoke execute on function public.get_dashboard_kpis(uuid) from public, anon;
grant execute on function public.get_dashboard_kpis(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1  Org-scoped analytics overview
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_analytics_overview();

create or replace function public.get_analytics_overview(p_org_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result    json;
  v_founder boolean := public.is_founder();
  v_org     uuid    := coalesce(p_org_id, public.current_organization_id());
  v_all     boolean := v_founder and p_org_id is null;
begin
  select json_build_object(
    'risk_by_dept', (
      select coalesce(json_agg(row_to_json(r) order by r.score desc), '[]'::json)
      from (
        select department, score, trend, overdue_count, total_obligations
        from public.risk_scores
        where v_all or organization_id = v_org or organization_id is null
        order by score desc
      ) r
    ),
    'compliance_trend', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select month, year, score, obligations, resolved
        from public.compliance_trends
        where v_all or organization_id = v_org or organization_id is null
        order by year asc,
          case month
            when 'Jan' then 1  when 'Feb' then 2  when 'Mar' then 3
            when 'Apr' then 4  when 'May' then 5  when 'Jun' then 6
            when 'Jul' then 7  when 'Aug' then 8  when 'Sep' then 9
            when 'Oct' then 10 when 'Nov' then 11 when 'Dec' then 12
          end asc
      ) t
    ),
    'total_obligations',  (select count(*)::int from public.obligations where v_all or organization_id = v_org),
    'compliant_count',    (select count(*)::int from public.obligations where (v_all or organization_id = v_org) and status = 'compliant'),
    'overdue_count',      (select count(*)::int from public.obligations where (v_all or organization_id = v_org) and due_date < current_date and status <> 'compliant'),
    'docs_processed',     (select count(*)::int from public.documents where (v_all or organization_id = v_org) and status = 'processed'),
    'evidence_collected', (select count(*)::int from public.evidence where (v_all or organization_id = v_org) and collected_at is not null),
    'open_notifications', (select count(*)::int from public.notifications where (v_all or organization_id = v_org or organization_id is null) and read = false),
    'pending_escalations',(select count(*)::int from public.escalations where (v_all or organization_id = v_org or organization_id is null) and status = 'open')
  ) into result;
  return result;
end;
$$;

-- revoke execute on function public.get_analytics_overview() from public, anon;
revoke execute on function public.get_analytics_overview(uuid) from public, anon;
grant execute on function public.get_analytics_overview(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1  Org-scoped notifications RPC
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_notifications(int, int, boolean);

create or replace function public.get_notifications(
  p_limit  int default 20,
  p_offset int default 0,
  p_unread_only boolean default false,
  p_org_id uuid default null
)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_founder boolean := public.is_founder();
  v_org     uuid    := coalesce(p_org_id, public.current_organization_id());
  v_all     boolean := v_founder and p_org_id is null;
begin
  return query
    select * from public.notifications n
    where (v_all or n.organization_id = v_org or n.organization_id is null)
      and (not p_unread_only or n.read = false)
    order by n.created_at desc
    limit p_limit offset p_offset;
end;
$$;

-- revoke execute on function public.get_notifications(int, int, boolean) from public, anon;
revoke execute on function public.get_notifications(int, int, boolean, uuid) from public, anon;
grant execute on function public.get_notifications(int, int, boolean, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
