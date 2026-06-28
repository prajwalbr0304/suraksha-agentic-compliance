/* eslint-disable @typescript-eslint/no-require-imports */
const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = process.cwd();
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error("Usage: node scripts/apply-db-migration.cjs <migration-file>");
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

async function main() {
  loadEnv();
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error("SUPABASE_DB_PASSWORD is required");
  }

  const sql = fs.readFileSync(path.resolve(root, migrationFile), "utf8");
  const statements = splitSqlStatements(sql);
  const projectId = process.env.SUPABASE_PROJECT_ID;
  // Prefer explicit host; else direct DB (works in most regions). Pooler optional via SUPABASE_POOLER_HOST.
  const pooler = process.env.SUPABASE_POOLER_HOST;
  const host =
    process.env.SUPABASE_DB_HOST ||
    pooler ||
    (projectId ? `db.${projectId}.supabase.co` : "");
  if (!host) {
    throw new Error("Set SUPABASE_PROJECT_ID or SUPABASE_DB_HOST or SUPABASE_POOLER_HOST");
  }
  const usePoolerUser = Boolean(pooler && host === pooler);
  const user =
    process.env.SUPABASE_DB_USER ||
    (usePoolerUser ? `postgres.${projectId}` : "postgres");
  const client = new Client({
    host,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    database: process.env.SUPABASE_DB_NAME || "postgres",
    user,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });

  await client.connect();
  try {
    await client.query("set lock_timeout = '15s'");
    await client.query("set statement_timeout = '120s'");
    console.log(`Applying ${migrationFile} (${statements.length} statements)`);
    for (let i = 0; i < statements.length; i += 1) {
      const statement = statements[i].trim();
      if (!statement) continue;
      const label = statement.split(/\s+/).slice(0, 6).join(" ");
      console.log(`[${i + 1}/${statements.length}] ${label}`);
      await client.query(statement);
    }
    console.log(`Applied ${migrationFile}`);
  } finally {
    await client.end();
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
