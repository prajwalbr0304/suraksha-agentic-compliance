-- =============================================================================
-- Migration 006: Complete Schema Alignment
-- Fills every gap found by codebase audit vs actual DB state.
-- Run in Supabase SQL Editor: https://app.supabase.com/project/stggdwlxsldonuhrxbhx/sql/new
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. documents table — add missing columns used by application code
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Add `filename` as a stored generated column that mirrors `name`
--     (drift/page.tsx, impact/page.tsx, and API routes all use `filename`)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename TEXT GENERATED ALWAYS AS (name) STORED;

-- 1b. Add `summary` column (used by impact API to describe the document)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT;

-- 1c. Add `regulation_name` column (used by impact API for named regulation)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS regulation_name TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. increment_evidence_count RPC function
--    Called by /api/evidence/route.ts after creating evidence items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_evidence_count(obl_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.obligations
  SET evidence_count = evidence_count + 1
  WHERE id = obl_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_evidence_count(UUID)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger on risk_scores
--    (risk_scores.updated_at column exists but no trigger)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS risk_scores_updated_at ON public.risk_scores;
CREATE TRIGGER risk_scores_updated_at
  BEFORE UPDATE ON public.risk_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger on documents
--    (documents uses processed_at, not updated_at — add updated_at column + trigger)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS documents_updated_at ON public.documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS policies for the 8 new tables (rowsecurity=TRUE but no policies)
--    Without policies, anon/authenticated clients cannot read these tables.
-- ─────────────────────────────────────────────────────────────────────────────

DO $policies$ BEGIN

-- 5a. departments
DROP POLICY IF EXISTS "Service role full access departments" ON departments;
CREATE POLICY "Service role full access departments"
  ON departments FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read departments" ON departments;
CREATE POLICY "Anon can read departments"
  ON departments FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Authenticated can read departments" ON departments;
CREATE POLICY "Authenticated can read departments"
  ON departments FOR SELECT TO authenticated USING (true);

-- 5b. drift_comparisons
DROP POLICY IF EXISTS "Service role full access drift_comparisons" ON drift_comparisons;
CREATE POLICY "Service role full access drift_comparisons"
  ON drift_comparisons FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read drift_comparisons" ON drift_comparisons;
CREATE POLICY "Anon can read drift_comparisons"
  ON drift_comparisons FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert drift_comparisons" ON drift_comparisons;
CREATE POLICY "Anon can insert drift_comparisons"
  ON drift_comparisons FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated full access drift_comparisons" ON drift_comparisons;
CREATE POLICY "Authenticated full access drift_comparisons"
  ON drift_comparisons FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5c. escalations
DROP POLICY IF EXISTS "Service role full access escalations" ON escalations;
CREATE POLICY "Service role full access escalations"
  ON escalations FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read escalations" ON escalations;
CREATE POLICY "Anon can read escalations"
  ON escalations FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert escalations" ON escalations;
CREATE POLICY "Anon can insert escalations"
  ON escalations FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can update escalations" ON escalations;
CREATE POLICY "Anon can update escalations"
  ON escalations FOR UPDATE TO anon USING (true);

-- 5d. graph_relationships
DROP POLICY IF EXISTS "Service role full access graph_relationships" ON graph_relationships;
CREATE POLICY "Service role full access graph_relationships"
  ON graph_relationships FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read graph_relationships" ON graph_relationships;
CREATE POLICY "Anon can read graph_relationships"
  ON graph_relationships FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert graph_relationships" ON graph_relationships;
CREATE POLICY "Anon can insert graph_relationships"
  ON graph_relationships FOR INSERT TO anon WITH CHECK (true);

-- 5e. impact_simulations
DROP POLICY IF EXISTS "Service role full access impact_simulations" ON impact_simulations;
CREATE POLICY "Service role full access impact_simulations"
  ON impact_simulations FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read impact_simulations" ON impact_simulations;
CREATE POLICY "Anon can read impact_simulations"
  ON impact_simulations FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert impact_simulations" ON impact_simulations;
CREATE POLICY "Anon can insert impact_simulations"
  ON impact_simulations FOR INSERT TO anon WITH CHECK (true);

-- 5f. notifications
DROP POLICY IF EXISTS "Service role full access notifications" ON notifications;
CREATE POLICY "Service role full access notifications"
  ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read notifications" ON notifications;
CREATE POLICY "Anon can read notifications"
  ON notifications FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can update notifications" ON notifications;
CREATE POLICY "Anon can update notifications"
  ON notifications FOR UPDATE TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert notifications" ON notifications;
CREATE POLICY "Anon can insert notifications"
  ON notifications FOR INSERT TO anon WITH CHECK (true);

-- 5g. readiness_scores
DROP POLICY IF EXISTS "Service role full access readiness_scores" ON readiness_scores;
CREATE POLICY "Service role full access readiness_scores"
  ON readiness_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read readiness_scores" ON readiness_scores;
CREATE POLICY "Anon can read readiness_scores"
  ON readiness_scores FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert readiness_scores" ON readiness_scores;
CREATE POLICY "Anon can insert readiness_scores"
  ON readiness_scores FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can update readiness_scores" ON readiness_scores;
CREATE POLICY "Anon can update readiness_scores"
  ON readiness_scores FOR UPDATE TO anon USING (true);

-- 5h. regulatory_versions
DROP POLICY IF EXISTS "Service role full access regulatory_versions" ON regulatory_versions;
CREATE POLICY "Service role full access regulatory_versions"
  ON regulatory_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can read regulatory_versions" ON regulatory_versions;
CREATE POLICY "Anon can read regulatory_versions"
  ON regulatory_versions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert regulatory_versions" ON regulatory_versions;
CREATE POLICY "Anon can insert regulatory_versions"
  ON regulatory_versions FOR INSERT TO anon WITH CHECK (true);

END $policies$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Realtime subscriptions for new tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE escalations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE readiness_scores; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE drift_comparisons; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE impact_simulations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE regulatory_versions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE graph_relationships; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed risk_scores with full department data (if only 1 row exists)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO risk_scores (department, score, trend, overdue_count, total_obligations)
SELECT v.department, v.score, v.trend::risk_trend, v.overdue_count, v.total_obligations
FROM (VALUES
  ('Compliance',      72, 'stable', 2, 18),
  ('Risk Management', 68, 'down',   3, 12),
  ('IT',              45, 'down',   5, 22),
  ('Legal',           88, 'up',     0,  8),
  ('Finance',         81, 'stable', 1, 10),
  ('Operations',      61, 'down',   4, 15),
  ('Internal Audit',  94, 'up',     0,  6),
  ('Fraud & AML',     49, 'down',   6, 14),
  ('Treasury',        73, 'stable', 1,  7),
  ('HR',              85, 'up',     0,  5)
) AS v(department, score, trend, overdue_count, total_obligations)
WHERE NOT EXISTS (
  SELECT 1 FROM risk_scores WHERE department = v.department
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Seed compliance_trends with 12-month historical data
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO compliance_trends (month, year, score, obligations, resolved)
SELECT v.month, v.year::smallint, v.score::smallint, v.obligations::smallint, v.resolved::smallint
FROM (VALUES
  ('Jun', 2025, 58, 32, 19),
  ('Jul', 2025, 61, 35, 21),
  ('Aug', 2025, 63, 38, 24),
  ('Sep', 2025, 65, 40, 26),
  ('Oct', 2025, 67, 43, 29),
  ('Nov', 2025, 68, 45, 31),
  ('Dec', 2025, 71, 48, 34),
  ('Jan', 2026, 74, 52, 38),
  ('Feb', 2026, 78, 55, 43),
  ('Mar', 2026, 73, 58, 42),
  ('Apr', 2026, 79, 61, 48)
) AS v(month, year, score, obligations, resolved)
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_trends WHERE month = v.month AND year = v.year::smallint
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Add analytics overview function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_overview()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'risk_by_dept', (
      SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.score DESC), '[]'::json)
      FROM (SELECT department, score, trend, overdue_count, total_obligations FROM risk_scores ORDER BY score DESC) r
    ),
    'compliance_trend', (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT month, year, score, obligations, resolved
        FROM compliance_trends
        ORDER BY year ASC,
          CASE month
            WHEN 'Jan' THEN 1  WHEN 'Feb' THEN 2  WHEN 'Mar' THEN 3
            WHEN 'Apr' THEN 4  WHEN 'May' THEN 5  WHEN 'Jun' THEN 6
            WHEN 'Jul' THEN 7  WHEN 'Aug' THEN 8  WHEN 'Sep' THEN 9
            WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
          END ASC
      ) t
    ),
    'total_obligations',  (SELECT count(*)::int FROM obligations),
    'compliant_count',    (SELECT count(*)::int FROM obligations WHERE status = 'compliant'),
    'overdue_count',      (SELECT count(*)::int FROM obligations WHERE due_date < current_date AND status != 'compliant'),
    'docs_processed',     (SELECT count(*)::int FROM documents WHERE status = 'processed'),
    'evidence_collected', (SELECT count(*)::int FROM evidence WHERE collected_at IS NOT NULL),
    'open_notifications', (SELECT count(*)::int FROM notifications WHERE read = false),
    'pending_escalations',(SELECT count(*)::int FROM escalations WHERE status = 'open')
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_overview()
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Update get_dashboard_kpis to include open escalations + notifications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result            JSON;
  total_obligations INT;
  compliance_score  NUMERIC;
  pending_maps      INT;
  docs_processed    INT;
  obligations_month INT;
  overdue_count     INT;
  docs_week         INT;
  open_notifs       INT;
  open_escalations  INT;
BEGIN
  SELECT count(*) INTO total_obligations FROM public.obligations;

  SELECT coalesce(
    round((count(*) FILTER (WHERE status = 'compliant')::numeric
          / nullif(count(*)::numeric, 0)) * 100, 1), 0
  ) INTO compliance_score FROM public.obligations;

  SELECT count(*) INTO pending_maps
    FROM public.map_cards WHERE status IN ('backlog','in_progress','review');

  SELECT count(*) INTO docs_processed
    FROM public.documents WHERE status = 'processed';

  SELECT count(*) INTO obligations_month
    FROM public.obligations WHERE created_at >= date_trunc('month', now());

  SELECT count(*) INTO overdue_count
    FROM public.map_cards WHERE due_date < current_date AND status != 'completed';

  SELECT count(*) INTO docs_week
    FROM public.documents WHERE uploaded_at >= date_trunc('week', now());

  SELECT count(*) INTO open_notifs
    FROM public.notifications WHERE read = false;

  SELECT count(*) INTO open_escalations
    FROM public.escalations WHERE status = 'open';

  result := json_build_object(
    'total_obligations',   total_obligations,
    'compliance_score',    compliance_score,
    'pending_maps',        pending_maps,
    'docs_processed',      docs_processed,
    'obligations_this_month', obligations_month,
    'overdue_count',       overdue_count,
    'docs_this_week',      docs_week,
    'open_notifications',  open_notifs,
    'open_escalations',    open_escalations
  );
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis()
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Get notifications with pagination function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notifications(
  p_limit  INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_unread_only BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.notifications LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM public.notifications
    WHERE (NOT p_unread_only OR read = false)
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notifications(INT, INT, BOOLEAN)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Indexes on new tables (performance)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(read, created_at DESC) WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_escalations_obligation
  ON escalations(obligation_id);

CREATE INDEX IF NOT EXISTS idx_escalations_open
  ON escalations(status) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_reg_versions_issued
  ON regulatory_versions(issued_date DESC);

CREATE INDEX IF NOT EXISTS idx_drift_docs
  ON drift_comparisons(base_doc_id, new_doc_id);

CREATE INDEX IF NOT EXISTS idx_impact_created
  ON impact_simulations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_readiness_computed
  ON readiness_scores(computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_trends_period
  ON compliance_trends(year DESC, month);

CREATE INDEX IF NOT EXISTS idx_risk_scores_dept
  ON risk_scores(department);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Add 6th notification (Audit Scheduled) that was in API seed but not DB
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO notifications (title, message, type, target_type, target_id)
SELECT 'Audit Scheduled', 'Internal audit for Q2 2026 has been scheduled — 3 departments to be reviewed.', 'info', 'audit', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notifications WHERE title = 'Audit Scheduled'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Done ✓
-- ─────────────────────────────────────────────────────────────────────────────
