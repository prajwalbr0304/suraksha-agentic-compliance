/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const root = process.cwd();

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
}

async function safeFetch(name, url, init) {
  const started = Date.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return {
      name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      detail: text.slice(0, 220),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: "network_error",
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function tcpProbe(name, host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port, timeout: 8000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve({ name, ok: true, status: "tcp_connected", ms: Date.now() - started, detail: `${host}:${port}` });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ name, ok: false, status: "timeout", ms: Date.now() - started, detail: `${host}:${port}` });
    });
    socket.on("error", (err) => {
      resolve({ name, ok: false, status: "tcp_error", ms: Date.now() - started, detail: err.message });
    });
  });
}

async function pgProbe(name, passwordLabel, password) {
  const started = Date.now();
  const client = new Client({
    host: `db.${process.env.SUPABASE_PROJECT_ID}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    const result = await client.query("select current_database() as database_name, current_user as user_name");
    await client.end();
    return {
      name,
      ok: true,
      status: "pg_connected",
      ms: Date.now() - started,
      detail: `${passwordLabel}: ${JSON.stringify(result.rows[0])}`,
    };
  } catch (err) {
    try { await client.end(); } catch {}
    return {
      name,
      ok: false,
      status: "pg_error",
      ms: Date.now() - started,
      detail: `${passwordLabel}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main() {
  loadEnv();
  const ref = process.env.SUPABASE_PROJECT_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const probes = [];
  probes.push(await safeFetch("management_health", `https://api.supabase.com/v1/projects/${ref}/health`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  probes.push(await safeFetch("management_database_context", `https://api.supabase.com/v1/projects/${ref}/database/context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  probes.push(await safeFetch("management_sql_select_1", `https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select 1 as ok;" }),
  }));
  probes.push(await safeFetch("postgrest_documents_service_role", `${url}/rest/v1/documents?select=id&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${serviceRole}` },
  }));
  probes.push(await safeFetch("postgrest_organizations_service_role", `${url}/rest/v1/organizations?select=id&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${serviceRole}` },
  }));

  const supabase = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    probes.push({
      name: "auth_admin_list_users",
      ok: !error,
      status: error ? "auth_error" : "ok",
      ms: 0,
      detail: error ? error.message : `users_page_count=${data.users.length}`,
    });
  } catch (err) {
    probes.push({ name: "auth_admin_list_users", ok: false, status: "network_error", ms: 0, detail: err.message });
  }

  try {
    const { data, error } = await supabase.storage.listBuckets();
    probes.push({
      name: "storage_list_buckets",
      ok: !error,
      status: error ? "storage_error" : "ok",
      ms: 0,
      detail: error ? error.message : `bucket_count=${data.length}`,
    });
  } catch (err) {
    probes.push({ name: "storage_list_buckets", ok: false, status: "network_error", ms: 0, detail: err.message });
  }

  probes.push(await tcpProbe("tcp_project_postgres_5432", `db.${ref}.supabase.co`, 5432));
  probes.push(await tcpProbe("tcp_supabase_api_443", "api.supabase.com", 443));
  probes.push(await pgProbe("pg_direct_with_service_role_as_password", "service_role_key", serviceRole));
  probes.push(await pgProbe("pg_direct_with_access_token_as_password", "access_token", accessToken));

  console.log(JSON.stringify({ project_ref: ref, probes }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
