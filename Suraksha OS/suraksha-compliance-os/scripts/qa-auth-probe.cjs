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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.QA_EMAIL || "manager@testbank.com";
const password = process.env.QA_PASSWORD || "anekal123";

(async () => {
  console.log("URL set:", !!url, "ANON set:", !!anon);
  const sb = createClient(url, anon);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.log("AUTH_FAIL:", error.status, error.message);
  } else {
    console.log("AUTH_OK user:", data.user?.email, "id:", data.user?.id);
  }
})();
