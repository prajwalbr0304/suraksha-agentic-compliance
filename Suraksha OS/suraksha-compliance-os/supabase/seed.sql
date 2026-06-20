-- =============================================================================
-- Suraksha Compliance OS — Seed Data (mirrors mock-data.ts)
-- Run AFTER schema.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Obligations
-- ---------------------------------------------------------------------------
insert into public.obligations (id, reference, title, description, regulation, jurisdiction, department, owner, status, priority, due_date, confidence_score, evidence_count, tags) values
  ('a1b2c3d4-0001-0001-0001-000000000001', 'OBL-001', 'Customer Due Diligence - Enhanced KYC for High-Risk Accounts', 'Enhanced due diligence requirements for high-risk customer accounts', 'RBI Master Direction 2024', 'RBI', 'Compliance', 'Priya Sharma', 'in_progress', 'high', '2024-03-15', 99, 2, ARRAY['Section 3.2.1', 'Annex A']),
  ('a1b2c3d4-0002-0002-0002-000000000002', 'OBL-002', 'Anti-Money Laundering Transaction Monitoring', 'AML transaction monitoring requirements per PMLA', 'PMLA Amendment 2023', 'FIU-IND', 'AML', 'Rahul Mehta', 'in_progress', 'high', '2024-02-28', 96, 3, ARRAY['Section 12(1)', 'Rule 7']),
  ('a1b2c3d4-0003-0003-0003-000000000003', 'OBL-003', 'Cybersecurity Framework Implementation', 'Implement RBI cybersecurity framework per circular', 'RBI Circular DoS.CO.CSITE', 'RBI', 'IT Security', 'Anita Desai', 'pending_review', 'medium', '2024-04-30', 92, 3, ARRAY['Para 4.1', 'Appendix II']),
  ('a1b2c3d4-0004-0004-0004-000000000004', 'OBL-004', 'Fair Practices Code - Lending Transparency', 'Transparency requirements for lending products', 'RBI Master Direction 2023', 'RBI', 'Retail Banking', 'Suresh Kumar', 'overdue', 'high', '2024-01-15', 94, 0, ARRAY['Chapter III', 'Section 8.2']),
  ('a1b2c3d4-0005-0005-0005-000000000005', 'OBL-005', 'Data Localization Compliance', 'Payment data localization as per RBI mandate', 'RBI Circular 2018/DPSS', 'RBI', 'IT Infrastructure', 'Vikram Singh', 'compliant', 'medium', '2024-01-30', 99, 2, ARRAY['Circular Para 2']),
  ('a1b2c3d4-0006-0006-0006-000000000006', 'OBL-006', 'Outsourcing Risk Management Framework', 'Risk framework for third-party service providers', 'RBI Guidelines 2024', 'RBI', 'Vendor Management', 'Vikram Singh', 'in_progress', 'low', '2024-05-15', 88, 0, ARRAY['Section 5', 'Annex C']),
  ('a1b2c3d4-0007-0007-0007-000000000007', 'OBL-007', 'Grievance Redressal Mechanism Enhancement', 'Upgrade customer grievance process per RBI mandate', 'RBI Master Circular 2023', 'RBI', 'Customer Service', 'Anita Desai', 'pending_review', 'medium', '2024-03-31', 93, 0, ARRAY['Section 11', 'Appendix I']),
  ('a1b2c3d4-0008-0008-0008-000000000008', 'OBL-008', 'Basel III Capital Adequacy Reporting', 'Quarterly capital adequacy ratio reporting', 'RBI Master Circular DBOD', 'RBI', 'Treasury', 'Suresh Kumar', 'in_progress', 'high', '2024-03-31', 97, 0, ARRAY['Para 3.1', 'Schedule A'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Risk Scores
-- ---------------------------------------------------------------------------
insert into public.risk_scores (department, score, trend, overdue_count, total_obligations) values
  ('AML',              78, 'down',   3, 45),
  ('KYC',              85, 'up',     1, 62),
  ('IT Security',      72, 'stable', 2, 38),
  ('Treasury',         91, 'up',     0, 29),
  ('Retail Banking',   65, 'down',   5, 78),
  ('Customer Service', 88, 'up',     1, 34),
  ('Vendor Management',70, 'stable', 2, 22)
on conflict (department) do nothing;

-- ---------------------------------------------------------------------------
-- Compliance Trends
-- ---------------------------------------------------------------------------
insert into public.compliance_trends (month, year, score, obligations, resolved, recorded_at) values
  ('Sep', 2023, 82, 1100, 980,  '2023-09-30 23:59:59+00'),
  ('Oct', 2023, 85, 1150, 1020, '2023-10-31 23:59:59+00'),
  ('Nov', 2023, 87, 1180, 1060, '2023-11-30 23:59:59+00'),
  ('Dec', 2023, 89, 1200, 1100, '2023-12-31 23:59:59+00'),
  ('Jan', 2024, 92, 1230, 1150, '2024-01-31 23:59:59+00'),
  ('Feb', 2024, 94, 1248, 1180, '2024-02-29 23:59:59+00')
on conflict (month, year) do nothing;

-- ---------------------------------------------------------------------------
-- Audit Trail
-- ---------------------------------------------------------------------------
insert into public.audit_trail (id, action, actor, actor_role, target, details, severity, metadata, created_at) values
  ('b1b2c3d4-0001-0001-0001-000000000001', 'document_uploaded',   'Priya Sharma',    'Compliance Officer', 'RBI Circular 2024/02.pdf',       'Uploaded document RBI Circular 2024/02.pdf',           'info',     '{"size": "2.4 MB", "type": "PDF"}',                      '2024-02-15 14:32:10+00'),
  ('b1b2c3d4-0002-0002-0002-000000000002', 'document_processed',  'AI Engine v3.2',  'System',             'RBI Circular 2024/02.pdf',       'Extracted 42 obligations from RBI Circular 2024/02.pdf','info',     '{"confidence": "96.8%", "duration": "3m 12s"}',          '2024-02-15 14:35:22+00'),
  ('b1b2c3d4-0003-0003-0003-000000000003', 'review_completed',    'Rahul Mehta',     'Senior Manager',     'KYC Enhancement Program',        'Approved MAP action plan for KYC Enhancement Program', 'info',     '{"status": "Approved", "remarks": "All evidence satisfactory"}', '2024-02-15 15:10:45+00'),
  ('b1b2c3d4-0004-0004-0004-000000000004', 'risk_flagged',        'System',          'System',             'AML Policy Gap Assessment',      'Auto-escalated overdue AML Policy Gap Assessment',     'warning',  '{"daysOverdue": "3", "assignee": "Rahul Mehta"}',        '2024-02-15 09:00:00+00'),
  ('b1b2c3d4-0005-0005-0005-000000000005', 'obligation_updated',  'Anita Desai',     'Compliance Analyst', 'Cybersecurity Framework',        'Modified obligation department mapping',               'info',     '{"field": "Department", "from": "IT", "to": "IT Security"}', '2024-02-14 16:45:30+00'),
  ('b1b2c3d4-0006-0006-0006-000000000006', 'evidence_added',      'Vikram Singh',    'Risk Officer',       'Outsourcing Risk Framework',     'Submitted review evidence for Outsourcing Risk Framework','info',  '{"evidenceCount": "3", "status": "Pending Review"}',     '2024-02-14 11:20:15+00'),
  ('b1b2c3d4-0007-0007-0007-000000000007', 'document_uploaded',   'Priya Sharma',    'Compliance Officer', 'SEBI Master Circular Q1.pdf',    'Uploaded SEBI Master Circular Q1.pdf',                 'info',     '{"size": "5.1 MB", "type": "PDF"}',                      '2024-02-14 10:15:00+00'),
  ('b1b2c3d4-0008-0008-0008-000000000008', 'document_processed',  'AI Engine v3.2',  'System',             'SEBI Master Circular Q1.pdf',    'Extracted 28 obligations from SEBI Master Circular Q1.pdf','info', '{"confidence": "94.2%", "duration": "7m 33s"}',          '2024-02-14 10:22:33+00')
on conflict (id) do nothing;
