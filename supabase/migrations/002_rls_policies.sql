-- =============================================================================
-- Migration 002: Row Level Security Policies
-- =============================================================================

-- Enable RLS
alter table public.obligations       enable row level security;
alter table public.documents         enable row level security;
alter table public.audit_trail       enable row level security;
alter table public.risk_scores       enable row level security;
alter table public.compliance_trends enable row level security;
alter table public.evidence          enable row level security;
alter table public.map_cards         enable row level security;

-- Service role bypass (for API routes using service_role key)
-- These allow the service role full access regardless of other policies
create policy "Service role full access obligations" on public.obligations for all to service_role using (true) with check (true);
create policy "Service role full access documents" on public.documents for all to service_role using (true) with check (true);
create policy "Service role full access audit_trail" on public.audit_trail for all to service_role using (true) with check (true);
create policy "Service role full access risk_scores" on public.risk_scores for all to service_role using (true) with check (true);
create policy "Service role full access compliance_trends" on public.compliance_trends for all to service_role using (true) with check (true);
create policy "Service role full access evidence" on public.evidence for all to service_role using (true) with check (true);
create policy "Service role full access map_cards" on public.map_cards for all to service_role using (true) with check (true);

-- Anon/authenticated read access (for the browser client)
create policy "Anon can read obligations" on public.obligations for select to anon using (true);
create policy "Anon can read documents" on public.documents for select to anon using (true);
create policy "Anon can read audit_trail" on public.audit_trail for select to anon using (true);
create policy "Anon can read risk_scores" on public.risk_scores for select to anon using (true);
create policy "Anon can read compliance_trends" on public.compliance_trends for select to anon using (true);
create policy "Anon can read evidence" on public.evidence for select to anon using (true);
create policy "Anon can read map_cards" on public.map_cards for select to anon using (true);

-- Anon write access (for demo; restrict in production to authenticated only)
create policy "Anon can insert obligations" on public.obligations for insert to anon with check (true);
create policy "Anon can update obligations" on public.obligations for update to anon using (true);
create policy "Anon can insert documents" on public.documents for insert to anon with check (true);
create policy "Anon can update documents" on public.documents for update to anon using (true);
create policy "Anon can insert audit_trail" on public.audit_trail for insert to anon with check (true);
create policy "Anon can insert evidence" on public.evidence for insert to anon with check (true);
create policy "Anon can update evidence" on public.evidence for update to anon using (true);
create policy "Anon can insert map_cards" on public.map_cards for insert to anon with check (true);
create policy "Anon can update map_cards" on public.map_cards for update to anon using (true);
create policy "Anon can update risk_scores" on public.risk_scores for update to anon using (true);
create policy "Anon can insert risk_scores" on public.risk_scores for insert to anon with check (true);
create policy "Anon can insert compliance_trends" on public.compliance_trends for insert to anon with check (true);
