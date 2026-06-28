-- =============================================================================
-- Migration 004: Database Functions for Dashboard KPIs
-- Server-side computed metrics for real-time dashboard
-- =============================================================================

-- Function: Get dashboard KPI metrics
create or replace function public.get_dashboard_kpis()
returns json language plpgsql security definer as $$
declare
  result json;
  total_obligations int;
  compliance_score numeric;
  pending_maps int;
  docs_processed int;
  obligations_this_month int;
  overdue_count int;
  docs_this_week int;
begin
  select count(*) into total_obligations from public.obligations;
  
  select coalesce(
    round(
      (count(*) filter (where status = 'compliant')::numeric / nullif(count(*)::numeric, 0)) * 100,
      1
    ), 0
  ) into compliance_score from public.obligations;
  
  select count(*) into pending_maps from public.map_cards where status in ('backlog', 'in_progress', 'review');
  
  select count(*) into docs_processed from public.documents where status = 'processed';
  
  select count(*) into obligations_this_month from public.obligations 
  where created_at >= date_trunc('month', now());
  
  select count(*) into overdue_count from public.map_cards 
  where due_date < current_date and status != 'completed';
  
  select count(*) into docs_this_week from public.documents 
  where uploaded_at >= date_trunc('week', now());

  result := json_build_object(
    'total_obligations', total_obligations,
    'compliance_score', compliance_score,
    'pending_maps', pending_maps,
    'docs_processed', docs_processed,
    'obligations_this_month', obligations_this_month,
    'overdue_count', overdue_count,
    'docs_this_week', docs_this_week
  );
  
  return result;
end;
$$;

-- Function: Get recent activity for dashboard (last 20 entries)
create or replace function public.get_recent_activity(limit_count int default 20)
returns setof public.audit_trail language plpgsql security definer as $$
begin
  return query
    select * from public.audit_trail
    order by created_at desc
    limit limit_count;
end;
$$;

-- Function: Get escalations (overdue obligations with MAP cards)
create or replace function public.get_escalations()
returns json language plpgsql security definer as $$
declare
  result json;
begin
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into result
  from (
    select 
      o.title,
      o.department,
      o.priority,
      (current_date - o.due_date) as days_overdue,
      m.id as map_id,
      m.owner
    from public.obligations o
    left join public.map_cards m on m.obligation_id = o.id
    where o.due_date < current_date 
      and o.status != 'compliant'
    order by (current_date - o.due_date) desc
    limit 10
  ) t;
  
  return result;
end;
$$;

-- Grant execute to anon and authenticated
grant execute on function public.get_dashboard_kpis() to anon, authenticated, service_role;
grant execute on function public.get_recent_activity(int) to anon, authenticated, service_role;
grant execute on function public.get_escalations() to anon, authenticated, service_role;
