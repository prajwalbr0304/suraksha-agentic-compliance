# Suraksha OS — QA Report

**Generated:** 2026-06-01T21:45:18.486Z  
**Environment:** http://localhost:3000 · project `stggdwlxsldonuhrxbhx` · org `19e46262-d9ed-449f-a5fb-4d443972e944`  
**Harness:** `scripts/qa-full-suite.cjs` (`npm run qa`)

## 1. Executive summary

- Functional checks: **26 passed / 0 failed** (26 total)
- Database-state validations: **16 passed / 0 failed** (16 total)
- Screenshots captured: **41**
- Defects: **0** — Critical: 0, High: 0, Medium: 0, Low: 0
- Overall: **PASS ✅**

## 2. Seed data uploaded

| Entity | Count |
|--------|------:|
| Documents | 5 |
| Obligations | 19 |
| Evidence | 12 |
| MAP cards | 10 |
| Escalations | 3 |
| Audit entries | 12 |
| Security findings | 8 |
| Notifications | 5 |

## 3. Business flow results

| Area | Check | Expected | Actual | Result |
|------|-------|----------|--------|--------|
| Flow1 | POST /api/obligations -> 201 | 201 | 201 | ✅ |
| Flow1 | POST /api/evidence -> 201 | 201 | 201 | ✅ |
| Flow1 | PUT /api/evidence (collect) -> 200 | 200 | 200 | ✅ |
| Flow1 | POST /api/map-cards -> 201 | 201 | 201 | ✅ |
| Flow1 | PUT /api/map-cards (in_progress) -> 200 | 200 | 200 | ✅ |
| Flow1 | PUT invalid status -> 400 (not 500) | 400 | 400 | ✅ |
| Flow1 | DELETE /api/map-cards -> 200 | 200 | 200 | ✅ |
| Flow1 | DELETE /api/obligations -> 200 | 200 | 200 | ✅ |
| Flow2 | POST /api/impact -> 200 | 200 | 200 | ✅ |
| Flow2 | impact result has risk_level | risk fields | ["id","summary","impacted_teams","engineering_effort","estimated_weeks","risk_le | ✅ |
| Flow2 | POST /api/drift -> 200 | 200 | 200 | ✅ |
| Flow2 | drift result returned | object | object | ✅ |
| Flow3 | POST security-findings -> 201 | 201 | 201 | ✅ |
| Flow3 | compliance read findings -> 403 | 403 | 403 | ✅ |
| Flow4 | POST notification -> 201 | 201 | 201 | ✅ |
| Flow4 | compliance create notification -> 403 | 403 | 403 | ✅ |
| Flow5 | org_admin PATCH settings -> 200 | 200 | 200 | ✅ |
| Flow5 | compliance PATCH settings -> 403 | 403 | 403 | ✅ |
| Flow6 | GET /api/readiness -> 200 | 200 | 200 | ✅ |
| Flow6 | readiness returns department scores | >=1 dept | 7 | ✅ |
| Flow7 | department_owner only sees Operations | only Operations | rows=2 | ✅ |
| Flow7 | IDOR map-card foreign obligation -> 403 | 403 | 403 | ✅ |
| Flow7 | validation missing title -> 400 | 400 | 400 | ✅ |
| Flow7 | unauthenticated -> 401 | 401 | 401 | ✅ |
| Dashboard-data | compliance: Recent Activity populated | activity rows | populated | ✅ |
| Dashboard-data | executive: Active Escalations populated | escalations | populated | ✅ |

## 4. Database state validation (after each transaction)

| Transaction | Table | Expectation | Detail | Result |
|-------------|-------|-------------|--------|--------|
| create obligation | obligations | row exists with correct org + dept | dept=Compliance org=19e46262-d9ed-449f-a5fb-4d443972e944 review=approved | ✅ |
| create obligation | audit_trail | obligation_created entry logged | entries=1 | ✅ |
| add evidence | evidence | evidence row exists in org | org=19e46262-d9ed-449f-a5fb-4d443972e944 | ✅ |
| add evidence | obligations | evidence_count incremented | evidence_count=1 | ✅ |
| collect evidence | evidence | collected_at set | collected_at=2026-06-01 approval=approved | ✅ |
| create map card | map_cards | status backlog + org scoped | status=backlog org=19e46262-d9ed-449f-a5fb-4d443972e944 | ✅ |
| move map card | map_cards | status -> in_progress | status=in_progress | ✅ |
| delete map card | map_cards | row removed | gone | ✅ |
| delete obligation | obligations | row removed | gone | ✅ |
| delete obligation | evidence | child evidence cascade-deleted | remaining=0 | ✅ |
| import finding | integration_findings | row upserted in org | org=19e46262-d9ed-449f-a5fb-4d443972e944 sev=high | ✅ |
| create notification | notifications | row created unread in org | read=false org=19e46262-d9ed-449f-a5fb-4d443972e944 | ✅ |
| save settings | organizations | settings.qa_marker persisted | marker=qa-1780349945403 | ✅ |
| settings tamper | organizations | compliance write did NOT change settings | marker=qa-1780349945403 | ✅ |
| readiness | readiness_scores | scores persisted for org | rows=7 | ✅ |
| idor map-card | map_cards | no row created by blocked IDOR | before=10 after=10 | ✅ |

## 5. Defect log

No defects detected. ✅

## 6. Screenshot index


### org_admin

- `/dashboard` → `test-results\qa\screenshots\org_admin\dashboard.png`
- `/documents` → `test-results\qa\screenshots\org_admin\documents.png`
- `/obligations` → `test-results\qa\screenshots\org_admin\obligations.png`
- `/analytics` → `test-results\qa\screenshots\org_admin\analytics.png`
- `/reports` → `test-results\qa\screenshots\org_admin\reports.png`
- `/settings` → `test-results\qa\screenshots\org_admin\settings.png`

### compliance_admin

- `/dashboard/compliance` → `test-results\qa\screenshots\compliance_admin\dashboard-compliance.png`
- `/documents` → `test-results\qa\screenshots\compliance_admin\documents.png`
- `/obligations` → `test-results\qa\screenshots\compliance_admin\obligations.png`
- `/map-board` → `test-results\qa\screenshots\compliance_admin\map-board.png`
- `/evidence` → `test-results\qa\screenshots\compliance_admin\evidence.png`
- `/knowledge-graph` → `test-results\qa\screenshots\compliance_admin\knowledge-graph.png`
- `/drift` → `test-results\qa\screenshots\compliance_admin\drift.png`
- `/readiness` → `test-results\qa\screenshots\compliance_admin\readiness.png`
- `/impact` → `test-results\qa\screenshots\compliance_admin\impact.png`
- `/audit` → `test-results\qa\screenshots\compliance_admin\audit.png`
- `/analytics` → `test-results\qa\screenshots\compliance_admin\analytics.png`
- `/reports` → `test-results\qa\screenshots\compliance_admin\reports.png`
- `/settings` → `test-results\qa\screenshots\compliance_admin\settings.png`
- `/upload` → `test-results\qa\screenshots\compliance_admin\upload.png`

### security_team

- `/dashboard/security` → `test-results\qa\screenshots\security_team\dashboard-security.png`
- `/security-findings` → `test-results\qa\screenshots\security_team\security-findings.png`
- `/obligations` → `test-results\qa\screenshots\security_team\obligations.png`
- `/map-board` → `test-results\qa\screenshots\security_team\map-board.png`
- `/evidence` → `test-results\qa\screenshots\security_team\evidence.png`

### internal_auditor

- `/dashboard/audit` → `test-results\qa\screenshots\internal_auditor\dashboard-audit.png`
- `/audit` → `test-results\qa\screenshots\internal_auditor\audit.png`
- `/knowledge-graph` → `test-results\qa\screenshots\internal_auditor\knowledge-graph.png`
- `/analytics` → `test-results\qa\screenshots\internal_auditor\analytics.png`
- `/reports` → `test-results\qa\screenshots\internal_auditor\reports.png`
- `/evidence` → `test-results\qa\screenshots\internal_auditor\evidence.png`

### executive_viewer

- `/dashboard/executive` → `test-results\qa\screenshots\executive_viewer\dashboard-executive.png`
- `/impact` → `test-results\qa\screenshots\executive_viewer\impact.png`
- `/analytics` → `test-results\qa\screenshots\executive_viewer\analytics.png`
- `/reports` → `test-results\qa\screenshots\executive_viewer\reports.png`
- `/documents` → `test-results\qa\screenshots\executive_viewer\documents.png`

### department_owner

- `/dashboard/team` → `test-results\qa\screenshots\department_owner\dashboard-team.png`
- `/obligations` → `test-results\qa\screenshots\department_owner\obligations.png`
- `/map-board` → `test-results\qa\screenshots\department_owner\map-board.png`
- `/evidence` → `test-results\qa\screenshots\department_owner\evidence.png`
- `/readiness` → `test-results\qa\screenshots\department_owner\readiness.png`

## 7. Coverage

- **Roles exercised:** org_admin, compliance_admin, security_team, internal_auditor, executive_viewer, department_owner
- **Dashboards:** executive, compliance, security, audit, team, generic
- **Flows:** obligation lifecycle, evidence, MAP board, impact, drift, security findings, notifications, settings, readiness, ABAC/IDOR/validation
- **Layers:** UI (screenshots), API (HTTP), Database (service-role state checks)
