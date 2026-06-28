/**
 * Applies only the audit_action enum extensions used by admin delete/update flows:
 *   020_department_deleted_audit.sql
 *   021_team_updated_deleted_audit.sql
 *
 * Requires in .env.local (same as apply-db-migration.cjs):
 *   SUPABASE_DB_PASSWORD
 *   SUPABASE_PROJECT_ID
 * Optional: SUPABASE_POOLER_HOST
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = process.cwd();
const migrations = [
  "supabase/migrations/020_department_deleted_audit.sql",
  "supabase/migrations/021_team_updated_deleted_audit.sql",
];

for (const m of migrations) {
  console.log(`\n>>> ${m}`);
  execFileSync(process.execPath, [path.join("scripts", "apply-db-migration.cjs"), m], {
    cwd: root,
    stdio: "inherit",
  });
}
console.log("\nAudit enum migrations 020 + 021 applied.");
