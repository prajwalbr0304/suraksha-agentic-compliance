-- 031: Backfill legacy AI MAP rows from ai_generated → pending_approval (manager queue).
-- Safe after 029 (enum). Optional normalization; skip if you want to keep ai_generated bucket.

update public.map_cards
set status = 'pending_approval'::map_status
where status = 'ai_generated'::map_status
  and coalesce(generated_by, 'manual') in ('ai', 'pipeline', 'agent');

notify pgrst, 'reload schema';
