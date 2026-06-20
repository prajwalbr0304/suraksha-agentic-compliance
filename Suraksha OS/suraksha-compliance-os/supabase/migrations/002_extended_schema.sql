-- =============================================================
-- Suraksha Compliance OS — Extended Schema v2
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → Run)
-- =============================================================

-- ---------------------------------------------------------------
-- 1. regulatory_versions — stores uploaded circular metadata
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regulatory_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  circular_ref  TEXT,
  issued_by     TEXT DEFAULT 'RBI',
  issued_date   DATE,
  effective_date DATE,
  version_no    INTEGER DEFAULT 1,
  is_latest     BOOLEAN DEFAULT TRUE,
  summary       TEXT,
  jurisdiction  TEXT DEFAULT 'India - RBI',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_versions_document ON regulatory_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_reg_versions_latest   ON regulatory_versions(is_latest);

-- ---------------------------------------------------------------
-- 2. drift_comparisons — regulatory drift between two versions
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drift_comparisons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_version_id UUID REFERENCES regulatory_versions(id) ON DELETE SET NULL,
  new_version_id  UUID REFERENCES regulatory_versions(id) ON DELETE SET NULL,
  base_doc_id     UUID REFERENCES documents(id) ON DELETE SET NULL,
  new_doc_id      UUID REFERENCES documents(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  summary         TEXT,
  new_obligations    INTEGER DEFAULT 0,
  removed_obligations INTEGER DEFAULT 0,
  changed_obligations INTEGER DEFAULT 0,
  drift_score     NUMERIC(5,2) DEFAULT 0,
  changes_json    JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drift_status ON drift_comparisons(status);

-- ---------------------------------------------------------------
-- 3. readiness_scores — department-level compliance readiness
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readiness_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT NOT NULL,
  score           NUMERIC(5,2) NOT NULL DEFAULT 0,
  max_score       NUMERIC(5,2) NOT NULL DEFAULT 100,
  status          TEXT DEFAULT 'at_risk' CHECK (status IN ('healthy','warning','at_risk','critical')),
  total_obligations  INTEGER DEFAULT 0,
  compliant_count    INTEGER DEFAULT 0,
  overdue_count      INTEGER DEFAULT 0,
  missing_evidence   INTEGER DEFAULT 0,
  audit_gaps         INTEGER DEFAULT 0,
  factors_json       JSONB DEFAULT '{}',
  recommendations    JSONB DEFAULT '[]',
  computed_at     TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readiness_dept ON readiness_scores(department);
CREATE INDEX IF NOT EXISTS idx_readiness_score ON readiness_scores(score DESC);

-- ---------------------------------------------------------------
-- 4. impact_simulations — AI-predicted impact for a circular
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impact_simulations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID REFERENCES documents(id) ON DELETE CASCADE,
  regulation_name   TEXT,
  impacted_teams    JSONB DEFAULT '[]',
  engineering_effort INTEGER DEFAULT 0,
  risk_level        TEXT DEFAULT 'medium' CHECK (risk_level IN ('critical','high','medium','low')),
  audit_risk        TEXT DEFAULT 'medium' CHECK (audit_risk IN ('critical','high','medium','low')),
  operational_risk  TEXT DEFAULT 'medium' CHECK (operational_risk IN ('critical','high','medium','low')),
  complexity        TEXT DEFAULT 'medium' CHECK (complexity IN ('high','medium','low')),
  estimated_weeks   INTEGER DEFAULT 4,
  summary           TEXT,
  affected_controls JSONB DEFAULT '[]',
  budget_estimate   NUMERIC(12,2),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impact_doc ON impact_simulations(document_id);

-- ---------------------------------------------------------------
-- 5. graph_relationships — knowledge graph edges
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   TEXT NOT NULL,   -- 'document' | 'obligation' | 'department' | 'control' | 'risk' | 'evidence'
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relationship  TEXT NOT NULL,  -- 'requires' | 'impacts' | 'generates' | 'mitigates' | 'owns'
  weight        NUMERIC(3,2) DEFAULT 1.0,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graph_source ON graph_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_graph_target ON graph_relationships(target_type, target_id);

-- ---------------------------------------------------------------
-- 6. notifications — in-app notification center
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  message     TEXT,
  type        TEXT DEFAULT 'info' CHECK (type IN ('info','warning','error','success','escalation')),
  target_type TEXT,
  target_id   TEXT,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read, created_at DESC);

-- ---------------------------------------------------------------
-- 7. escalations — automatic escalation tracking
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id   UUID REFERENCES obligations(id) ON DELETE CASCADE,
  map_card_id     UUID REFERENCES map_cards(id) ON DELETE CASCADE,
  escalated_to    TEXT NOT NULL,
  reason          TEXT,
  severity        TEXT DEFAULT 'high' CHECK (severity IN ('critical','high','medium','low')),
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_status ON escalations(status);

-- ---------------------------------------------------------------
-- 8. departments table (reference)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  head        TEXT,
  email       TEXT,
  risk_level  TEXT DEFAULT 'medium',
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO departments (name, head, email, risk_level) VALUES
  ('Compliance',     'Chief Compliance Officer',  'compliance@bank.in',  'high'),
  ('Risk Management','Chief Risk Officer',         'risk@bank.in',        'high'),
  ('IT',             'Chief Information Officer',  'it@bank.in',          'medium'),
  ('Legal',          'General Counsel',            'legal@bank.in',       'medium'),
  ('Finance',        'Chief Financial Officer',    'finance@bank.in',     'low'),
  ('Operations',     'Head of Operations',         'ops@bank.in',         'medium'),
  ('HR',             'Head of HR',                 'hr@bank.in',          'low'),
  ('Internal Audit', 'Chief Internal Auditor',     'audit@bank.in',       'high'),
  ('Treasury',       'Head of Treasury',           'treasury@bank.in',    'medium'),
  ('Fraud & AML',    'Head of Fraud & AML',        'framl@bank.in',       'high')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------
-- 9. Add columns to existing obligations table (if missing)
-- ---------------------------------------------------------------
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS citation        TEXT;
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS section_ref     TEXT;
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS extraction_reason TEXT;
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,2) DEFAULT 75;
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS compliance_risk TEXT DEFAULT 'medium';
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS evidence_required JSONB DEFAULT '[]';
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS linked_paragraph TEXT;

-- ---------------------------------------------------------------
-- 10. Add columns to existing map_cards table (if missing)
-- ---------------------------------------------------------------
ALTER TABLE map_cards ADD COLUMN IF NOT EXISTS effort_hours    INTEGER DEFAULT 8;
ALTER TABLE map_cards ADD COLUMN IF NOT EXISTS department      TEXT;
ALTER TABLE map_cards ADD COLUMN IF NOT EXISTS tags            JSONB DEFAULT '[]';
ALTER TABLE map_cards ADD COLUMN IF NOT EXISTS comments_count  INTEGER DEFAULT 0;

-- ---------------------------------------------------------------
-- 11. Seed realistic notifications
-- ---------------------------------------------------------------
INSERT INTO notifications (title, message, type, target_type, target_id) VALUES
  ('Overdue Obligation Detected',    '3 obligations in Cyber Security department are past their deadline.', 'escalation', 'obligation', NULL),
  ('New Circular Processed',         'RBI Circular RBI/2024-25/87 has been extracted — 12 obligations identified.', 'success', 'document', NULL),
  ('Readiness Score Dropped',        'IT department readiness score fell below 60% threshold.', 'warning', 'department', NULL),
  ('Evidence Gap Alert',             'VA/PT obligation has 0 evidence items collected.', 'error', 'evidence', NULL),
  ('MAP Card Escalated',             'SOC Monitoring implementation is 14 days overdue — escalated to CISO.', 'escalation', 'map_card', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 12. Seed realistic readiness scores
-- ---------------------------------------------------------------
INSERT INTO readiness_scores (department, score, max_score, status, total_obligations, compliant_count, overdue_count, missing_evidence, audit_gaps, recommendations) VALUES
  ('Compliance',     82, 100, 'warning',  18, 15, 2, 3, 1, '["Schedule quarterly review","Update PMLA policy documentation"]'),
  ('Risk Management',74, 100, 'warning',  12,  9, 1, 4, 2, '["Complete RCSA exercise","Update risk appetite framework"]'),
  ('IT',             61, 100, 'at_risk',  22, 13, 4, 7, 3, '["Conduct VA/PT","Implement SOC 2.0","Patch critical vulnerabilities"]'),
  ('Legal',          91, 100, 'healthy',   8,  8, 0, 1, 0, '["Archive completed matters"]'),
  ('Finance',        88, 100, 'healthy',  10,  9, 0, 2, 0, '["Submit Q4 capital adequacy report"]'),
  ('Operations',     69, 100, 'at_risk',  15, 10, 3, 5, 2, '["Update BCP document","Test DR plan","Map critical processes"]'),
  ('Internal Audit', 95, 100, 'healthy',   6,  6, 0, 0, 0, '["Complete IS audit schedule"]'),
  ('Fraud & AML',    57, 100, 'critical', 14,  8, 5, 6, 4, '["File pending STRs","Conduct AML training","Update transaction monitoring rules"]')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 13. Enable realtime on new tables
-- ---------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE escalations;
ALTER PUBLICATION supabase_realtime ADD TABLE readiness_scores;

-- Done ✓
