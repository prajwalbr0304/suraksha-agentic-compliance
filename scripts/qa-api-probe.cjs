/* eslint-disable */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i);
  if (!process.env[k]) process.env[k] = t.slice(i + 1);
}

const BASE = "http://localhost:3000";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const ROUTES = [
  "/api/me",
  "/api/notifications",
  "/api/regulatory-sources",
  "/api/regulation-center?limit=5",
  "/api/agents/status",
  "/api/agents/runs",
  "/api/obligations",
  "/api/documents",
];

(async () => {
  const { data, error } = await sb.auth.signInWithPassword({
    email: "manager@testbank.com",
    password: "anekal123",
  });
  if (error) {
    console.log("SIGNIN_FAIL", error.message);
    process.exit(1);
  }
  const token = data.session.access_token;
  console.log("TOKEN_OK len", token.length, "org_user", data.user.id);
  for (const r of ROUTES) {
    try {
      const res = await fetch(BASE + r, { headers: { Authorization: "Bearer " + token } });
      let snippet = "";
      try {
        const j = await res.json();
        snippet = JSON.stringify(j).slice(0, 120);
      } catch {
        snippet = (await res.text().catch(() => "")).slice(0, 80);
      }
      console.log(`${res.status}  ${r}  ${snippet}`);
    } catch (e) {
      console.log(`ERR  ${r}  ${String(e).slice(0, 80)}`);
    }
  }
})();
