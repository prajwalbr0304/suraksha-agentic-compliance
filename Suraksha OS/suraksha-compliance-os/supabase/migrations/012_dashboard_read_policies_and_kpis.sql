-- =============================================================================
-- Migration 012: Restore authenticated read access for dashboard widgets + fix KPIs
-- -----------------------------------------------------------------------------
-- Migration 002 created `to anon` SELECT policies on audit_trail / risk_scores /
-- compliance_trends (the app was anon-key only back then). Migration 007 dropped
-- the permissive anon policies but never added authenticated equivalents, so
-- after auth hardening the browser dashboard hooks (useDashboard, useEscalations,
-- useAuditTrail) silently read 0 rows under RLS — leaving "Recent Activity",
-- "Department Risk Overview", "Compliance Trend" and "Active Escalations" blank.
--
-- This migration adds authenticated, org-scoped SELECT policies so those widgets
-- render, and extends get_dashboard_kpis with high_risk_count + obligation-based
-- overdue_count (fixes the "undefined high risk" / "0 overdue" KPI subtitles).
-- =============================================================================

-- Aggregate reference tables (global, no org column) — readable by any authenticated user.
drop policy if exists "Authenticated can read risk_scores" on public.risk_scores;
create policy "Authenticated can read risk_scores"
  on public.risk_scores for select to authenticated using (true);

drop policy if exists "Authenticated can read compliance_trends" on public.compliance_trends;
create policy "Authenticated can read compliance_trends"
  on public.compliance_trends for select to authenticated using (true);

-- Org-scoped tables — readable by members of the owning organization (or legacy null-org rows).
drop policy if exists "Authenticated can read org audit_trail" on public.audit_trail;
create policy "Authenticated can read org audit_trail"
  on public.audit_trail for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read org readiness_scores" on public.readiness_scores;
create policy "Authenticated can read org readiness_scores"
  on public.readiness_scores for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "Authenticated can read org escalations" on public.escalations;
create policy "Authenticated can read org escalations"
  on public.escalations for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);

-- Extend dashboard KPIs: add high_risk_count + make overdue_count obligation-based.
create or replace function public.get_dashboard_kpis()
returns json language plpgsql security definer
set search_path = public as $$
declare
  result            json;
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
  select count(*) into total_obligations from public.obligations;

  select coalesce(
    round((count(*) filter (where status = 'compliant')::numeric
          / nullif(count(*)::numeric, 0)) * 100, 1), 0
  ) into compliance_score from public.obligations;

  select count(*) into pending_maps
    from public.map_cards where status in ('backlog','in_progress','review');

  select count(*) into docs_processed
    from public.documents where status = 'processed';

  select count(*) into obligations_month
    from public.obligations where created_at >= date_trunc('month', now());

  -- Obligation-based overdue: explicitly overdue, or past-due and not yet compliant.
  select count(*) into overdue_count
    from public.obligations
    where status = 'overdue'
       or (due_date < current_date and status <> 'compliant');

  select count(*) into high_risk_count
    from public.obligations where priority in ('critical','high');

  select count(*) into docs_week
    from public.documents where uploaded_at >= date_trunc('week', now());

  select count(*) into open_notifs
    from public.notifications where read = false;

  select count(*) into open_escalations
    from public.escalations where status = 'open';

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

grant execute on function public.get_dashboard_kpis() to anon, authenticated, service_role;
