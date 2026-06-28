-- 029: Extend map_status enum ONLY (separate transaction from data / functions).
alter type public.map_status add value if not exists 'pending_approval';
alter type public.map_status add value if not exists 'archived';

notify pgrst, 'reload schema';
