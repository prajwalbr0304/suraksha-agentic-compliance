-- Audit enum for department removal (manager / founder org admin)
alter type public.audit_action add value if not exists 'department_deleted';
