/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Apply a migration SQL file via Supabase Management API (HTTPS).
 * Use when direct Postgres (port 5432) is blocked from your network.
 *
 * Requires in .env.local:
 *   SUPABASE_ACCESS_TOKEN  (Dashboard → Account → Access Tokens; scope database:write)
 *   SUPABASE_PROJECT_ID
 *
 * Usage:
 *   node scripts/apply-migration-management-api.cjs supabase/migrations/022_dashboard_hero_kpis.sql
 */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error("Usage: node scripts/apply-migration-management-api.cjs <migration-file>");
  process.exit(1);
}

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    if (!process.env[trimmed.slice(0, idx)]) {
      process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!inSingle && !inDouble && !dollarTag && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      current += "\n";
      continue;
    }

    if (!inDouble && !dollarTag && ch === "'" && sql[i - 1] !== "\\") {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (!inSingle && !dollarTag && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === "$") {
      const rest = sql.slice(i);
      const match = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        current += tag;
        i += tag.length - 1;
        dollarTag = dollarTag === tag ? null : tag;
        continue;
      }
    }

    if (!inSingle && !inDouble && !dollarTag && ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function runQuery(ref, token, query) {
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    let hint = "";
    if (res.status === 403) {
      hint =
        " Create a Supabase personal access token with scope that includes **database write** (see Dashboard → Account → Access Tokens), then set SUPABASE_ACCESS_TOKEN in .env.local.";
    }
    const msg = typeof body === "object" && body && (body.message || body.error || body.msg)
      ? JSON.stringify(body)
      : text.slice(0, 500);
    throw new Error(`HTTP ${res.status}: ${msg}.${hint}`);
  }
  return body;
}

async function main() {
  loadEnv();
  const ref = process.env.SUPABASE_PROJECT_ID;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref) throw new Error("SUPABASE_PROJECT_ID is required");
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required (Management API)");

  const sql = fs.readFileSync(path.resolve(root, migrationFile), "utf8");
  const statements = splitSqlStatements(sql);
  console.log(`Applying ${migrationFile} via Management API (${statements.length} statements)`);

  await runQuery(ref, token, "select 1 as management_api_ping");

  for (let i = 0; i < statements.length; i += 1) {
    const statement = statements[i].trim();
    if (!statement) continue;
    const label = statement.split(/\s+/).slice(0, 6).join(" ");
    console.log(`[${i + 1}/${statements.length}] ${label}`);
    await runQuery(ref, token, statement);
  }
  console.log(`Applied ${migrationFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
