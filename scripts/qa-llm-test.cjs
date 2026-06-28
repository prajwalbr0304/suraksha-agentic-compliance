/* eslint-disable */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
for (const l of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i);
  if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
const BASE = "http://localhost:3000";
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const INSTR =
  "You are a banking compliance analyst. Given the text of a regulatory change (RBI/SEBI/PMLA), " +
  "extract every discrete, actionable compliance obligation. Return ONLY a JSON array. Each item: " +
  '{"title": str, "description": str, "priority": one of [critical,high,medium,low], ' +
  '"risk": one of [high,medium,low], "citation": str, "suggested_department": str}. No prose, JSON only.';

async function callOllama(model, text, useFormat) {
  const body = {
    model,
    messages: [
      { role: "system", content: INSTR },
      { role: "user", content: `Regulatory change:\n\nTitle: RBI Commercial Banks Credit Facilities\n\n${text}` },
    ],
    stream: false,
  };
  if (useFormat) body.format = "json";
  const t0 = Date.now();
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify(body) });
  const j = await r.json();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = j.message?.content || "";
  let parsed = null;
  try { parsed = JSON.parse(out); } catch {}
  if (!parsed) {
    const m = out.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch {} }
  }
  const n = Array.isArray(parsed) ? parsed.length : parsed && Array.isArray(parsed.obligations) ? parsed.obligations.length : parsed ? 1 : 0;
  console.log(`\n=== ${model} format=${!!useFormat} | ${secs}s | parsed=${parsed ? "OK" : "FAIL"} | obligations=${n}`);
  console.log("  raw head:", out.slice(0, 160).replace(/\n/g, " "));
}

(async () => {
  const { data } = await anon.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  const me = await (await fetch(BASE + "/api/me", { headers: { Authorization: "Bearer " + data.session.access_token } })).json();
  const org = me.organizationId;
  const { data: rows } = await svc
    .from("regulatory_changes")
    .select("title,raw_text")
    .eq("organization_id", org)
    .ilike("title", "%Credit Facilities%")
    .limit(1);
  const text = (rows?.[0]?.raw_text || "").slice(0, 6000);
  console.log("title:", rows?.[0]?.title, "| textlen:", text.length);
  const model = process.argv[2] || "llama3.2:latest";
  const fmt = process.argv[3] === "json";
  await callOllama(model, text, fmt);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
