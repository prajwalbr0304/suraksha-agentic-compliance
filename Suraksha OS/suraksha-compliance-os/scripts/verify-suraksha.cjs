/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

const requiredFiles = [
  "supabase/migrations/007_auth_rbac_ai_integrations.sql",
  "lib/auth/permissions.ts",
  "app/login/page.tsx",
  "app/dashboard/executive/page.tsx",
  "app/dashboard/security/page.tsx",
  "app/dashboard/audit/page.tsx",
  "app/dashboard/compliance/page.tsx",
  "app/dashboard/team/page.tsx",
  "app/api/integrations/security-findings/route.ts",
  "app/api/ai-pipeline/route.ts",
];

const requiredMigrationSnippets = [
  "create table if not exists public.organizations",
  "create table if not exists public.organization_members",
  "create table if not exists public.document_chunks",
  "create table if not exists public.extraction_reviews",
  "create table if not exists public.integration_findings",
  "create policy",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error("Missing required implementation files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const migration = read("supabase/migrations/007_auth_rbac_ai_integrations.sql");
const missingSnippets = requiredMigrationSnippets.filter((snippet) => !migration.includes(snippet));
if (missingSnippets.length > 0) {
  console.error("Migration is missing expected snippets:");
  for (const snippet of missingSnippets) console.error(`- ${snippet}`);
  process.exit(1);
}

const guardedRoutes = [
  "app/api/documents/route.ts",
  "app/api/obligations/route.ts",
  "app/api/upload-document/route.ts",
  "app/api/extract-obligations/route.ts",
  "app/api/admin/migrate/route.ts",
];

const unguarded = guardedRoutes.filter((file) => !read(file).includes("requirePermission"));
if (unguarded.length > 0) {
  console.error("Expected guarded API routes to use requirePermission:");
  for (const file of unguarded) console.error(`- ${file}`);
  process.exit(1);
}

console.log("Suraksha verification passed.");
