/* eslint-disable */
// Verify Regulation Center action endpoints respond (NON-blocking; does not wait
// for the ~10min Ollama extraction). Confirms the wiring I added works end-to-end.
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

(async () => {
  const { data } = await sb.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  const token = data.session.access_token;
  const H = { Authorization: "Bearer " + token, "content-type": "application/json" };

  // 1) logs endpoint (new)
  let r = await fetch(BASE + "/api/regulation-center/logs?limit=5", { headers: H });
  const logsBody = await r.json().catch(() => ({}));
  console.log("LOGS:", r.status, "lines=", Array.isArray(logsBody.lines) ? logsBody.lines.length : "n/a");

  // 2) sources list — find a configured source id (sourceId) for source_id-scoped run
  r = await fetch(BASE + "/api/regulatory-sources", { headers: H });
  const sj = await r.json().catch(() => ({}));
  const configured = (sj.sources || []).filter((s) => s.sourceId);
  console.log("SOURCES:", r.status, "total=", (sj.sources || []).length, "configured=", configured.length);

  // 3) Trigger a watch run scoped to one source (returns 202 immediately; agent works async)
  if (configured.length) {
    const sid = configured[0].sourceId;
    r = await fetch(BASE + "/api/agents/runs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ pipeline: "watch", source_id: sid }),
    });
    const runBody = await r.json().catch(() => ({}));
    console.log("WATCH_RUN(source_id):", r.status, "run_id=", runBody.run_id || runBody.error || JSON.stringify(runBody).slice(0, 100));
  } else {
    console.log("WATCH_RUN: skipped (no configured source)");
  }

  // 4) Confirm a DELETE guard exists (call DELETE with bogus id -> expect 404, not 500/route-missing)
  r = await fetch(BASE + "/api/regulation-center?id=00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: H });
  console.log("DELETE_GUARD reg-center bogus id:", r.status, (await r.text().catch(() => "")).slice(0, 80));

  r = await fetch(BASE + "/api/regulatory-sources?id=00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: H });
  console.log("DELETE_GUARD sources bogus id:", r.status, (await r.text().catch(() => "")).slice(0, 80));
})();
