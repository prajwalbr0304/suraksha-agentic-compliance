-- =============================================================================
-- 028: MAP lifecycle — team_id column, backfill rows, refresh get_dashboard_kpis.
-- Requires 027_map_lifecycle_statuses.sql applied first (enum values committed).
-- =============================================================================

alter table public.map_cards
  add column if not exists team_id uuid references public.teams(id) on delete set null;

create index if not exists idx_map_cards_team on public.map_cards(team_id);

-- Backfill: AI / pipeline / agent suggestions → triage column
update public.map_cards
set status = 'ai_generated'::map_status
where status = 'backlog'::map_status
  and coalesce(generated_by, 'manual') in ('ai', 'pipeline', 'agent');

-- Remaining backlog → manager-ready (human-created or legacy)
update public.map_cards
set status = 'approved'::map_status
where status = 'backlog'::map_status;

-- Legacy "review" → under_review
update public.map_cards
set status = 'under_review'::map_status
where status = 'review'::map_status;

-- Approved + assignee → assigned
update public.map_cards
set status = 'assigned'::map_status
where assigned_to is not null
  and status = 'approved'::map_status;

-- Escalation flag → escalated status (operational problem lane)
update public.map_cards
set status = 'escalated'::map_status
where escalated = true
  and status in ('in_progress'::map_status, 'assigned'::map_status, 'under_review'::map_status);

-- ── Dashboard KPIs (same shape as 022) ─────────────────────────────────────
create or replace function public.get_dashboard_kpis(p_org_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result               json;
  v_founder            boolean := public.is_founder();
  v_org                uuid    := coalesce(p_org_id, public.current_organization_id());
  v_all                boolean := v_founder and p_org_id is null;
  total_obligations    int;
  compliance_score     numeric;
  pending_maps         int;
  docs_processed       int;
  obligations_month    int;
  overdue_count        int;
  high_risk_count      int;
  docs_week            int;
  open_notifs          int;
  open_escalations     int;
  new_regulations_30d  int;
  open_obligations     int;
  critical_maps        int;
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

  -- Open MAP work: anything not terminal
  select count(*) into pending_maps
    from public.map_cards m
    where (v_all or m.organization_id = v_org)
      and m.status not in ('completed'::map_status, 'rejected'::map_status);

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

  select count(*) into new_regulations_30d
    from public.regulatory_changes rc
    where (v_all or rc.organization_id = v_org)
      and rc.created_at >= (now() - interval '30 days');

  select count(*) into open_obligations
    from public.obligations o
    where (v_all or o.organization_id = v_org)
      and o.status <> 'compliant';

  select count(*) into critical_maps
    from public.map_cards m
    where (v_all or m.organization_id = v_org)
      and m.priority = 'critical'
      and m.status not in ('completed'::map_status, 'rejected'::map_status);

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
    'open_escalations',       open_escalations,
    'new_regulations_30d',    new_regulations_30d,
    'open_obligations',       open_obligations,
    'critical_maps',          critical_maps
  );
  return result;
end;
$$;

revoke execute on function public.get_dashboard_kpis(uuid) from public, anon;
grant execute on function public.get_dashboard_kpis(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
