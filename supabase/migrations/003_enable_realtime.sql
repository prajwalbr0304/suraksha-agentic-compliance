-- =============================================================================
-- Migration 003: Enable Realtime
-- Enables Supabase Realtime on all tables for live subscriptions
-- =============================================================================

-- Enable realtime for publication
alter publication supabase_realtime add table public.obligations;
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.audit_trail;
alter publication supabase_realtime add table public.risk_scores;
alter publication supabase_realtime add table public.compliance_trends;
alter publication supabase_realtime add table public.evidence;
alter publication supabase_realtime add table public.map_cards;
