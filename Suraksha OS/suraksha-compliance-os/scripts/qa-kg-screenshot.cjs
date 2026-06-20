/* eslint-disable */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
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
const URL_REF = process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1];
const STORAGE_KEY = `sb-${URL_REF}-auth-token`;

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data } = await sb.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  const session = data.session;
  const me = await (await fetch(BASE + "/api/me", { headers: { Authorization: "Bearer " + session.access_token } })).json();
  const slug = "test-cooperative-bank";

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.evaluate(
    ([key, val]) => localStorage.setItem(key, val),
    [STORAGE_KEY, JSON.stringify(session)],
  );
  await page.goto(`${BASE}/dashboard/${slug}/knowledge-graph`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  const out = path.join(__dirname, "..", "test-results", "kg-after.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log("saved:", out);
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
