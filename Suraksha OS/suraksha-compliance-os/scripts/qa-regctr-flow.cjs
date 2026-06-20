/* eslint-disable */
/**
 * Regulation Center end-to-end flow driver (API-level, same endpoints the UI calls).
 *
 * Phases (pass as argv[2]):
 *   setup    - disable all sources except KEEP, set approval_required=true on KEEP
 *   download - trigger `download` pipeline for KEEP source, poll run + logs, verify document_id
 *   harden   - verify approve is blocked (400) on an item with no document_id
 *   approve  - approve 2 downloaded items (with document_id) -> queued
 *   process  - trigger process_regulations, poll run + obligations/maps counts
 *   state    - print current sources + lifecycle counts
 *
 * Run: node scripts/qa-regctr-flow.cjs <phase>
 */
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
const KEEP = "rbi_notifications";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const { data, error } = await sb.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  if (error) throw new Error("login failed: " + error.message);
  return { Authorization: "Bearer " + data.session.access_token, "content-type": "application/json" };
}

async function getSources(H) {
  const r = await fetch(BASE + "/api/regulatory-sources", { headers: H });
  const j = await r.json();
  return j.sources || [];
}

async function getChanges(H) {
  const r = await fetch(BASE + "/api/regulation-center?limit=300", { headers: H });
  const j = await r.json();
  return j.changes || [];
}

function lifecycleCounts(changes) {
  const byLife = {};
  for (const c of changes) byLife[c.lifecycle_status] = (byLife[c.lifecycle_status] || 0) + 1;
  return byLife;
}

async function getRun(H, runId) {
  const r = await fetch(BASE + "/api/agents/runs", { headers: H });
  const arr = await r.json();
  return (Array.isArray(arr) ? arr : []).find((x) => x.id === runId) || null;
}

async function phaseState(H) {
  const sources = await getSources(H);
  console.log("=== SOURCES ===");
  for (const s of sources) {
    console.log(
      `${s.enabled ? "ON " : "off"} | sid=${s.sourceId ? s.sourceId.slice(0, 8) : "------"} | ${s.catalogId} | approvalReq=${s.approvalRequired} | ${s.sourceType}`,
    );
  }
  const changes = await getChanges(H);
  console.log("=== lifecycle counts ===", JSON.stringify(lifecycleCounts(changes)));
  const withDoc = changes.filter((c) => c.document_id).length;
  console.log("changes with document_id:", withDoc, "/", changes.length);
}

async function phaseSetup(H) {
  const sources = await getSources(H);
  const keep = sources.find((s) => s.catalogId === KEEP);
  if (!keep || !keep.sourceId) throw new Error(`KEEP source ${KEEP} not configured`);
  console.log("KEEP:", keep.catalogId, keep.sourceId);
  for (const s of sources) {
    if (!s.sourceId) continue;
    if (s.catalogId === KEEP) {
      // enable + require approval so downloads land in New (awaiting_approval)
      const r = await fetch(BASE + "/api/regulatory-sources", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ id: s.sourceId, enabled: true, approval_required: true }),
      });
      console.log(`KEEP enable+approvalReq: ${r.status}`);
    } else if (s.enabled) {
      const r = await fetch(BASE + "/api/regulatory-sources", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ id: s.sourceId, enabled: false }),
      });
      console.log(`disable ${s.catalogId}: ${r.status}`);
    }
  }
  const after = await getSources(H);
  const onCount = after.filter((s) => s.enabled).length;
  console.log("enabled sources now:", onCount, after.filter((s) => s.enabled).map((s) => s.catalogId).join(","));
}

async function phaseDownload(H) {
  const sources = await getSources(H);
  const keep = sources.find((s) => s.catalogId === KEEP);
  const before = await getChanges(H);
  const beforeDocIds = new Set(before.filter((c) => c.document_id).map((c) => c.id));
  console.log("before: with document_id =", beforeDocIds.size);

  const r = await fetch(BASE + "/api/agents/runs", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ pipeline: "download", source_id: keep.sourceId }),
  });
  const j = await r.json();
  console.log("download POST:", r.status, JSON.stringify(j));
  if (r.status !== 202 || !j.run_id) throw new Error("download not accepted");
  const runId = j.run_id;

  // poll up to 10 min
  const deadline = Date.now() + 10 * 60 * 1000;
  let run = null;
  while (Date.now() < deadline) {
    await sleep(8000);
    run = await getRun(H, runId);
    const st = run?.status || "?";
    const stage = run?.stats?.pipeline_stage_label || run?.stats?.pipeline_stage_key || "";
    process.stdout.write(`  run=${st} ${stage}\n`);
    if (st === "completed" || st === "failed") break;
  }
  console.log("download run final:", run?.status, JSON.stringify(run?.stats || {}));

  const after = await getChanges(H);
  const newDocs = after.filter((c) => c.document_id && !beforeDocIds.has(c.id));
  console.log("NEW items with document_id after download:", newDocs.length);
  for (const c of newDocs.slice(0, 10)) {
    console.log(`  + ${c.lifecycle_status} | doc=${c.document_id.slice(0, 8)} | ${(c.title || "").slice(0, 70)}`);
  }
  console.log("=== lifecycle counts after ===", JSON.stringify(lifecycleCounts(after)));
}

async function phaseHarden(H) {
  const changes = await getChanges(H);
  const undoc = changes.find((c) => !c.document_id && ["new", "awaiting_approval", "failed_ingest"].includes(c.lifecycle_status));
  if (!undoc) {
    console.log("HARDEN: no undocumented item found to test (skip)");
    return;
  }
  const r = await fetch(BASE + "/api/regulation-center", {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ id: undoc.id, action: "approve" }),
  });
  const j = await r.json();
  console.log(`HARDEN approve(no-doc): status=${r.status} (expect 400) body=${JSON.stringify(j).slice(0, 160)}`);
}

async function phaseApprove(H) {
  const changes = await getChanges(H);
  const approvable = changes.filter(
    (c) => c.document_id && ["new", "awaiting_approval"].includes(c.lifecycle_status),
  );
  console.log("approvable (doc + new/awaiting):", approvable.length);
  const pick = approvable.slice(0, 2);
  for (const c of pick) {
    const r = await fetch(BASE + "/api/regulation-center", {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ id: c.id, action: "approve" }),
    });
    const j = await r.json();
    console.log(`approve ${c.id.slice(0, 8)} (${(c.title || "").slice(0, 40)}): ${r.status} -> ${j.change?.lifecycle_status || JSON.stringify(j).slice(0, 120)}`);
  }
}

async function phaseProcess(H) {
  const before = await getChanges(H);
  console.log("before process lifecycle:", JSON.stringify(lifecycleCounts(before)));
  const r = await fetch(BASE + "/api/agents/runs", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ pipeline: "process_regulations" }),
  });
  const j = await r.json();
  console.log("process POST:", r.status, JSON.stringify(j));
  if (r.status !== 202 || !j.run_id) throw new Error("process not accepted");
  console.log("RUN_ID=" + j.run_id);
}

async function countTable(table) {
  const { count } = await sb.from(table).select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function phaseMonitor(H) {
  const runId = process.argv[3];
  if (!runId) throw new Error("usage: monitor <run_id>");
  const oblBase = await countTable("obligations");
  const mapBase = await countTable("map_cards");
  console.log(`baseline: obligations=${oblBase} map_cards=${mapBase}`);
  const deadline = Date.now() + 40 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const run = await getRun(H, runId);
    const changes = await getChanges(H);
    const lc = lifecycleCounts(changes);
    const obl = await countTable("obligations");
    const maps = await countTable("map_cards");
    const st = run?.status || "?";
    const stage = run?.stats?.pipeline_stage_label || "";
    const line = `[${new Date().toLocaleTimeString()}] run=${st} ${stage} | proc=${lc.processing || 0} queued=${lc.queued || 0} completed=${lc.completed || 0} | obl=${obl}(+${obl - oblBase}) maps=${maps}(+${maps - mapBase})`;
    if (line.slice(0, 60) !== last.slice(0, 60) || true) console.log(line);
    last = line;
    if (st === "completed" || st === "failed") {
      console.log("FINAL run stats:", JSON.stringify(run?.stats || {}));
      break;
    }
    await sleep(20000);
  }
}

async function phaseFeatures(H) {
  // Logs endpoint
  let r = await fetch(BASE + "/api/regulation-center/logs?limit=20", { headers: H });
  let j = await r.json();
  console.log(`logs: status=${r.status} lines=${(j.lines || []).length}`);
  if ((j.lines || []).length) {
    const l = j.lines[0];
    console.log(`  sample: [${l.level}] ${l.stage || l.agent || l.source}: ${(l.message || "").slice(0, 60)}`);
  }

  // RAG search endpoint
  r = await fetch(BASE + "/api/regulation-center/search", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ q: "cash reserve ratio", matchCount: 5 }),
  });
  j = await r.json();
  console.log(`search: status=${r.status} results=${(j.results || []).length} ${j.error ? "err=" + j.error : ""}`);

  // Source edit roundtrip (change fetch_interval_minutes then revert)
  const sources = await getSources(H);
  const keep = sources.find((s) => s.catalogId === KEEP);
  const origInterval = keep.fetchIntervalMinutes || 360;
  r = await fetch(BASE + "/api/regulatory-sources", {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ id: keep.sourceId, fetch_interval_minutes: 120 }),
  });
  console.log(`source edit interval->120: status=${r.status}`);
  const after = await getSources(H);
  const now = after.find((s) => s.catalogId === KEEP);
  console.log(`  persisted interval=${now.fetchIntervalMinutes} (expect 120)`);
  r = await fetch(BASE + "/api/regulatory-sources", {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ id: keep.sourceId, fetch_interval_minutes: origInterval }),
  });
  console.log(`source edit revert->${origInterval}: status=${r.status}`);

  // Delete guards (bogus ids -> 404, not crash)
  r = await fetch(BASE + "/api/regulation-center?id=00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: H });
  console.log(`delete change(bogus): status=${r.status} (expect 404)`);
  r = await fetch(BASE + "/api/regulatory-sources?id=00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: H });
  console.log(`delete source(bogus): status=${r.status} (expect 404)`);
}

(async () => {
  const phase = process.argv[2] || "state";
  const H = await login();
  if (phase === "state") await phaseState(H);
  else if (phase === "setup") await phaseSetup(H);
  else if (phase === "download") await phaseDownload(H);
  else if (phase === "harden") await phaseHarden(H);
  else if (phase === "approve") await phaseApprove(H);
  else if (phase === "features") await phaseFeatures(H);
  else if (phase === "process") await phaseProcess(H);
  else if (phase === "monitor") await phaseMonitor(H);
  else console.log("unknown phase:", phase);
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
