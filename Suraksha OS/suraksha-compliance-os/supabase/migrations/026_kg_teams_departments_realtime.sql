-- Realtime for org structure so the knowledge graph can refresh when teams / departments change.
do $$ begin
  alter publication supabase_realtime add table public.teams;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.departments;
exception when duplicate_object then null; end $$;
