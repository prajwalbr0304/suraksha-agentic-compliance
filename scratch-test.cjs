const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
for (const line of (fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/) : [])) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i === -1) continue;
  const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await c.auth.signInWithPassword({
    email: "manager@hdfc-bank.suraksha.local",
    password: "SurakshaManager@2026"
  });
  if (error) {
    console.error("Auth error:", error.message);
    return;
  }
  const tok = data.session.access_token;
  const res = await fetch("http://localhost:3000/api/analytics", {
    headers: { Authorization: `Bearer ${tok}` }
  });
  console.log("Status:", res.status);
  try {
    const json = await res.json();
    console.log("Response Body:", JSON.stringify(json, null, 2));
  } catch (err) {
    console.log("Response Text:", await res.text());
  }
}
main().catch(console.error);
