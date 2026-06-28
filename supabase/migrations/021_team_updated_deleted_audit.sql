-- Audit actions for team update/delete (manager admin).
alter type public.audit_action add value if not exists 'team_updated';
alter type public.audit_action add value if not exists 'team_deleted';
