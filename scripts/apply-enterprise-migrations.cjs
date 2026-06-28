/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Convenience wrapper: applies the enterprise + agentic migrations (013–025) in order.
 * Usage: SUPABASE_DB_PASSWORD=... node scripts/apply-enterprise-migrations.cjs
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const MIGRATIONS = [
  "013_enterprise_roles.sql",
  "014_enterprise_tenancy.sql",
  "015_enterprise_rbac_seed.sql",
  "016_founder_rls.sql",
  "017_enterprise_audit_actions.sql",
  "018_agentic.sql",
  "019_tenant_isolation_hardening.sql",
  "020_department_deleted_audit.sql",
  "021_team_updated_deleted_audit.sql",
  "022_dashboard_hero_kpis.sql",
  "023_regulatory_pdf_ingestion.sql",
  "024_regulatory_sources_slots_health.sql",
  "025_orchestration_dedupe.sql",
];

const root = process.cwd();
for (const m of MIGRATIONS) {
  console.log(`\n=== Applying ${m} ===`);
  execFileSync(process.execPath, [path.join("scripts", "apply-db-migration.cjs"), `supabase/migrations/${m}`], {
    cwd: root,
    stdio: "inherit",
  });
}
console.log("\nAll enterprise + agentic migrations applied.");
