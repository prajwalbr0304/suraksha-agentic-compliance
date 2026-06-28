/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Idempotent demo seed for Suraksha OS.
 *
 * Populates the demo organization with realistic, org-scoped content so every
 * dashboard, the knowledge graph, readiness, analytics, reports, drift, impact,
 * audit trail and security findings come alive.
 *
 * Safe to re-run: it first removes previously seeded rows (tagged with SEED-/seed/
 * markers) for the demo org, then re-inserts a fresh set.
 *
 * Usage:  node scripts/seed-demo-data.cjs
 * Needs:  NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
}
loadEnv();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ORG_SLUG = "suraksha-demo-bank";
const daysFromNow = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const isoMinus = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function main() {
  // 1. Resolve org + demo users
  const org = await must("find org", db.from("organizations").select("id, slug").eq("slug", ORG_SLUG).maybeSingle());
  if (!org) throw new Error(`Demo organization '${ORG_SLUG}' not found. Apply migration 007 first.`);
  const orgId = org.id;
  console.log(`Org: ${ORG_SLUG} (${orgId})`);

  const usersResp = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (usersResp.error) throw new Error(`listUsers: ${usersResp.error.message}`);
  const byEmail = {};
  for (const u of usersResp.data.users) byEmail[(u.email || "").toLowerCase()] = u.id;
  const uid = (e) => byEmail[e] || null;
  const COMPLIANCE = uid("compliance@suraksha.local");
  const OWNER = uid("owner@suraksha.local");
  const SECURITY = uid("security@suraksha.local");
  console.log(`Users: compliance=${!!COMPLIANCE} owner=${!!OWNER} security=${!!SECURITY}`);

  // 2. Clean previous seed (cascades handle children of obligations/documents)
  console.log("Cleaning previous seed…");
  await db.from("integration_findings").delete().eq("organization_id", orgId).like("external_id", "seed-%");
  await db.from("notifications").delete().eq("organization_id", orgId).like("title", "[SEED]%");
  await db.from("audit_trail").delete().eq("organization_id", orgId).contains("metadata", { seed: true });
  await db.from("obligations").delete().eq("organization_id", orgId).like("reference", "SEED-%"); // cascades evidence/map_cards/escalations
  await db.from("documents").delete().eq("organization_id", orgId).like("storage_path", "seed/%"); // cascades remaining obligations

  // 3. Documents (processed). Two RBI KYC versions enable drift analysis.
  const docDefs = [
    { key: "kyc_v1", name: "RBI Master Direction – KYC (2023)", regulation_name: "RBI Master Direction - KYC", summary: "Know Your Customer norms for banks and NBFCs (2023 edition).", obligations_extracted: 4, days: 240 },
    { key: "kyc_v2", name: "RBI Master Direction – KYC (2024 Amendment)", regulation_name: "RBI Master Direction - KYC", summary: "2024 amendment introducing periodic re-KYC and video-KYC controls.", obligations_extracted: 5, days: 30 },
    { key: "lodr", name: "SEBI LODR (Amendment) Regulations 2024", regulation_name: "SEBI LODR 2024", summary: "Listing Obligations and Disclosure Requirements amendments.", obligations_extracted: 3, days: 60 },
    { key: "cyber", name: "RBI Cyber Security Framework 2024", regulation_name: "RBI Cyber Security Framework", summary: "Baseline cyber resilience and incident reporting requirements.", obligations_extracted: 4, days: 45 },
    { key: "basel", name: "Basel III Capital Adequacy Norms", regulation_name: "Basel III", summary: "Capital adequacy, leverage and liquidity coverage standards.", obligations_extracted: 3, days: 90 },
  ];
  const docRows = docDefs.map((d, i) => ({
    name: d.name,
    size: 240000 + i * 51234,
    mime_type: "application/pdf",
    storage_path: `seed/${d.key}.pdf`,
    status: "processed",
    obligations_extracted: d.obligations_extracted,
    confidence_score: 88 + (i % 6),
    uploaded_by: "compliance@suraksha.local",
    uploaded_at: isoMinus(d.days),
    processed_at: isoMinus(d.days - 1),
    regulation_name: d.regulation_name,
    summary: d.summary,
    organization_id: orgId,
    created_by: COMPLIANCE,
    metadata: { seed: true },
  }));
  const docs = await must("insert documents", db.from("documents").insert(docRows).select("id, storage_path"));
  const docId = (k) => docs.find((d) => d.storage_path === `seed/${k}.pdf`).id;
  console.log(`Documents: ${docs.length}`);

  // 4. Obligations across departments/status/priority
  const O = (o) => ({
    reference: `SEED-${o.ref}`,
    title: o.title,
    description: o.description || `${o.title} — regulatory obligation tracked by Suraksha OS.`,
    regulation: o.regulation,
    jurisdiction: "India",
    department: o.department,
    owner: o.owner || "Compliance Team",
    status: o.status,
    priority: o.priority,
    due_date: o.due_date,
    confidence_score: o.confidence ?? 90,
    evidence_count: 0,
    tags: o.tags || [],
    citation: o.citation || null,
    compliance_risk: o.risk || "medium",
    document_id: o.doc ? docId(o.doc) : null,
    organization_id: orgId,
    created_by: COMPLIANCE,
    assigned_to: o.assignOwner ? OWNER : null,
    review_status: "approved",
  });

  const obligationDefs = [
    // KYC v1 (older)
    O({ ref: "KYC-001", title: "Maintain customer identification records", regulation: "RBI Master Direction - KYC", department: "Compliance", status: "compliant", priority: "high", due_date: daysFromNow(-30), citation: "Sec 3.1", risk: "low", doc: "kyc_v1", tags: ["KYC", "records"] }),
    O({ ref: "KYC-002", title: "Periodic risk categorisation of customers", regulation: "RBI Master Direction - KYC", department: "Risk Management", status: "in_progress", priority: "high", due_date: daysFromNow(20), citation: "Sec 4.2", risk: "medium", doc: "kyc_v1" }),
    O({ ref: "KYC-003", title: "Suspicious transaction monitoring", regulation: "RBI Master Direction - KYC", department: "Compliance", status: "at_risk", priority: "critical", due_date: daysFromNow(7), citation: "Sec 6.1", risk: "high", doc: "kyc_v1" }),
    O({ ref: "KYC-004", title: "Annual KYC policy board review", regulation: "RBI Master Direction - KYC", department: "Legal", status: "overdue", priority: "medium", due_date: daysFromNow(-10), citation: "Sec 2.4", risk: "high", doc: "kyc_v1" }),
    // KYC v2 (newer) — shares some titles (modified), adds new ones
    O({ ref: "KYC-101", title: "Maintain customer identification records", regulation: "RBI Master Direction - KYC", department: "Compliance", status: "compliant", priority: "high", due_date: daysFromNow(40), citation: "Sec 3.1", risk: "low", doc: "kyc_v2" }),
    O({ ref: "KYC-102", title: "Periodic risk categorisation of customers", regulation: "RBI Master Direction - KYC", department: "Risk Management", status: "in_progress", priority: "high", due_date: daysFromNow(50), citation: "Sec 4.2", risk: "medium", doc: "kyc_v2" }),
    O({ ref: "KYC-103", title: "Mandatory video-based customer identification (V-CIP)", regulation: "RBI Master Direction - KYC", department: "IT", status: "in_progress", priority: "critical", due_date: daysFromNow(15), citation: "Sec 5.7", risk: "high", doc: "kyc_v2", tags: ["new", "VCIP"] }),
    O({ ref: "KYC-104", title: "Periodic re-KYC for high-risk customers", regulation: "RBI Master Direction - KYC", department: "Operations", status: "at_risk", priority: "high", due_date: daysFromNow(9), citation: "Sec 5.9", risk: "high", doc: "kyc_v2", assignOwner: true }),
    O({ ref: "KYC-105", title: "Customer consent capture for data sharing", regulation: "RBI Master Direction - KYC", department: "Legal", status: "pending_review", priority: "medium", due_date: daysFromNow(35), citation: "Sec 7.2", risk: "medium", doc: "kyc_v2" }),
    // SEBI LODR
    O({ ref: "LODR-001", title: "Quarterly financial results disclosure", regulation: "SEBI LODR 2024", department: "Finance", status: "compliant", priority: "high", due_date: daysFromNow(-5), citation: "Reg 33", risk: "low", doc: "lodr" }),
    O({ ref: "LODR-002", title: "Related party transactions disclosure", regulation: "SEBI LODR 2024", department: "Finance", status: "in_progress", priority: "medium", due_date: daysFromNow(25), citation: "Reg 23", risk: "medium", doc: "lodr" }),
    O({ ref: "LODR-003", title: "Material event disclosure within 24 hours", regulation: "SEBI LODR 2024", department: "Compliance", status: "at_risk", priority: "high", due_date: daysFromNow(3), citation: "Reg 30", risk: "high", doc: "lodr" }),
    // Cyber
    O({ ref: "CYB-001", title: "Security Operations Centre (SOC) monitoring", regulation: "RBI Cyber Security Framework", department: "IT", status: "compliant", priority: "critical", due_date: daysFromNow(-2), citation: "Annex I.3", risk: "low", doc: "cyber" }),
    O({ ref: "CYB-002", title: "Cyber incident reporting within 6 hours", regulation: "RBI Cyber Security Framework", department: "IT", status: "in_progress", priority: "critical", due_date: daysFromNow(12), citation: "Annex I.7", risk: "high", doc: "cyber" }),
    O({ ref: "CYB-003", title: "Quarterly VAPT of critical systems", regulation: "RBI Cyber Security Framework", department: "IT", status: "overdue", priority: "high", due_date: daysFromNow(-15), citation: "Annex II.1", risk: "high", doc: "cyber" }),
    O({ ref: "CYB-004", title: "Annual cyber resilience drill", regulation: "RBI Cyber Security Framework", department: "Operations", status: "pending_review", priority: "medium", due_date: daysFromNow(60), citation: "Annex II.6", risk: "medium", doc: "cyber", assignOwner: true }),
    // Basel
    O({ ref: "BAS-001", title: "Maintain minimum capital adequacy ratio", regulation: "Basel III", department: "Treasury", status: "compliant", priority: "critical", due_date: daysFromNow(-8), citation: "Para 50", risk: "low", doc: "basel" }),
    O({ ref: "BAS-002", title: "Liquidity Coverage Ratio reporting", regulation: "Basel III", department: "Treasury", status: "in_progress", priority: "high", due_date: daysFromNow(18), citation: "Para 90", risk: "medium", doc: "basel" }),
    O({ ref: "BAS-003", title: "Leverage ratio disclosure", regulation: "Basel III", department: "Finance", status: "at_risk", priority: "medium", due_date: daysFromNow(5), citation: "Para 120", risk: "medium", doc: "basel" }),
  ];
  const obligations = await must("insert obligations", db.from("obligations").insert(obligationDefs).select("id, reference, department, status, priority"));
  const oRef = (r) => obligations.find((o) => o.reference === `SEED-${r}`).id;
  console.log(`Obligations: ${obligations.length}`);

  // 5. Evidence (some collected, some pending)
  const evDefs = [
    { ref: "KYC-001", title: "Customer ID register export", collected: true },
    { ref: "KYC-001", title: "Sample KYC dossiers (10)", collected: true },
    { ref: "KYC-003", title: "STR filing acknowledgements", collected: false },
    { ref: "KYC-103", title: "V-CIP vendor SOC2 report", collected: true },
    { ref: "KYC-104", title: "Re-KYC due list (high-risk)", collected: false },
    { ref: "LODR-001", title: "Q3 results filing receipt", collected: true },
    { ref: "CYB-001", title: "SOC monitoring dashboard screenshot", collected: true },
    { ref: "CYB-003", title: "VAPT report (pending vendor)", collected: false },
    { ref: "BAS-001", title: "CAR computation workpaper", collected: true },
    { ref: "BAS-002", title: "LCR daily report", collected: true },
    { ref: "LODR-003", title: "Material event log", collected: false },
    { ref: "CYB-002", title: "Incident response runbook", collected: true },
  ];
  const evRows = evDefs.map((e) => ({
    obligation_id: oRef(e.ref),
    title: e.title,
    description: "",
    collected_at: e.collected ? daysFromNow(-(2 + Math.floor(Math.random() * 20))) : null,
    completed: !!e.collected,
    organization_id: orgId,
    created_by: COMPLIANCE,
    approval_status: e.collected ? "approved" : "pending",
  }));
  const evidence = await must("insert evidence", db.from("evidence").insert(evRows).select("id"));
  console.log(`Evidence: ${evidence.length}`);
  // refresh evidence_count
  for (const ref of [...new Set(evDefs.map((e) => e.ref))]) {
    const count = evDefs.filter((e) => e.ref === ref).length;
    await db.from("obligations").update({ evidence_count: count }).eq("id", oRef(ref));
  }

  // 6. MAP cards across columns
  const mapDefs = [
    { ref: "KYC-003", title: "Remediate STR monitoring gaps", status: "in_progress", priority: "critical", department: "Compliance", escalated: true },
    { ref: "KYC-103", title: "Roll out V-CIP across branches", status: "in_progress", priority: "critical", department: "IT" },
    { ref: "KYC-104", title: "Run re-KYC campaign (high-risk)", status: "backlog", priority: "high", department: "Operations", assignOwner: true },
    { ref: "CYB-002", title: "Automate 6-hour incident reporting", status: "review", priority: "critical", department: "IT" },
    { ref: "CYB-003", title: "Schedule quarterly VAPT", status: "backlog", priority: "high", department: "IT", escalated: true },
    { ref: "LODR-003", title: "Tighten material-event workflow", status: "in_progress", priority: "high", department: "Compliance" },
    { ref: "BAS-002", title: "Automate LCR reporting", status: "review", priority: "high", department: "Treasury" },
    { ref: "KYC-001", title: "Archive KYC records (annual)", status: "completed", priority: "medium", department: "Compliance" },
    { ref: "LODR-001", title: "Publish Q3 results", status: "completed", priority: "high", department: "Finance" },
    { ref: "CYB-004", title: "Plan cyber resilience drill", status: "backlog", priority: "medium", department: "Operations", assignOwner: true },
  ];
  const mapRows = mapDefs.map((m) => ({
    title: m.title,
    obligation_id: oRef(m.ref),
    owner: m.department + " Lead",
    due_date: daysFromNow(10 + Math.floor(Math.random() * 40)),
    status: m.status,
    priority: m.priority,
    escalated: !!m.escalated,
    department: m.department,
    organization_id: orgId,
    assigned_to: m.assignOwner ? OWNER : COMPLIANCE,
  }));
  const maps = await must("insert map_cards", db.from("map_cards").insert(mapRows).select("id"));
  console.log(`MAP cards: ${maps.length}`);

  // 7. Escalations (open)
  const escDefs = [
    { ref: "KYC-003", to: "compliance@suraksha.local", reason: "STR monitoring at risk of breach", severity: "critical" },
    { ref: "CYB-003", to: "security@suraksha.local", reason: "VAPT overdue 15 days", severity: "high" },
    { ref: "KYC-004", to: "compliance@suraksha.local", reason: "Annual KYC board review overdue", severity: "high" },
  ];
  const escRows = escDefs.map((e) => ({
    obligation_id: oRef(e.ref),
    escalated_to: e.to,
    reason: e.reason,
    severity: e.severity,
    status: "open",
    organization_id: orgId,
  }));
  const escs = await must("insert escalations", db.from("escalations").insert(escRows).select("id"));
  console.log(`Escalations: ${escs.length}`);

  // 8. Audit trail
  const auditDefs = [
    { action: "document_uploaded", actor: "compliance@suraksha.local", role: "compliance_admin", target: "RBI KYC 2024", details: "Uploaded RBI KYC 2024 amendment", severity: "info", days: 12 },
    { action: "document_processed", actor: "compliance@suraksha.local", role: "compliance_admin", target: "RBI KYC 2024", details: "AI extracted 5 obligations", severity: "info", days: 12 },
    { action: "obligation_created", actor: "compliance@suraksha.local", role: "compliance_admin", target: "V-CIP", details: "Created obligation for video-KYC", severity: "info", days: 11 },
    { action: "risk_flagged", actor: "compliance@suraksha.local", role: "compliance_admin", target: "STR monitoring", details: "Flagged STR monitoring as at-risk", severity: "warning", days: 9 },
    { action: "alert_generated", actor: "system", role: "system", target: "VAPT", details: "VAPT overdue — escalation raised", severity: "critical", days: 8 },
    { action: "evidence_added", actor: "owner@suraksha.local", role: "department_owner", target: "Re-KYC list", details: "Added re-KYC due list evidence", severity: "info", days: 6 },
    { action: "map_created", actor: "compliance@suraksha.local", role: "compliance_admin", target: "V-CIP rollout", details: "Created MAP card for V-CIP", severity: "info", days: 5 },
    { action: "map_status_changed", actor: "compliance@suraksha.local", role: "compliance_admin", target: "Incident reporting", details: "Moved to review", severity: "info", days: 4 },
    { action: "review_completed", actor: "audit@suraksha.local", role: "internal_auditor", target: "Q3 evidence", details: "Reviewed Q3 evidence pack", severity: "info", days: 3 },
    { action: "obligation_updated", actor: "compliance@suraksha.local", role: "compliance_admin", target: "LCR reporting", details: "Updated status to in-progress", severity: "info", days: 2 },
    { action: "risk_flagged", actor: "system", role: "system", target: "Material event", details: "Material-event disclosure at risk", severity: "warning", days: 1 },
    { action: "obligation_closed", actor: "compliance@suraksha.local", role: "compliance_admin", target: "Q3 results", details: "Closed Q3 results obligation", severity: "info", days: 1 },
  ];
  const auditRows = auditDefs.map((a) => ({
    action: a.action,
    actor: a.actor,
    actor_role: a.role,
    target: a.target,
    details: a.details,
    severity: a.severity,
    metadata: { seed: true },
    organization_id: orgId,
    actor_user_id: a.actor === "compliance@suraksha.local" ? COMPLIANCE : a.actor === "owner@suraksha.local" ? OWNER : null,
    created_at: isoMinus(a.days),
  }));
  const audit = await must("insert audit_trail", db.from("audit_trail").insert(auditRows).select("id"));
  console.log(`Audit entries: ${audit.length}`);

  // 9. Security findings
  const findDefs = [
    { source: "trivy", title: "Outdated OpenSSL in payment-gateway image", severity: "high", asset: "payment-gateway:1.4", dept: "IT", status: "open" },
    { source: "gitleaks", title: "AWS key committed in feature branch", severity: "critical", asset: "repo: core-banking", dept: "IT", status: "open" },
    { source: "semgrep", title: "SQL string concatenation in report module", severity: "medium", asset: "reporting-svc", dept: "IT", status: "open" },
    { source: "wazuh", title: "Brute-force attempts on admin portal", severity: "high", asset: "admin-portal", dept: "IT", status: "open" },
    { source: "trivy", title: "Critical CVE in base node image", severity: "critical", asset: "kyc-api:2.0", dept: "IT", status: "open" },
    { source: "osquery", title: "Unauthorized USB device on teller workstation", severity: "medium", asset: "WS-OPS-22", dept: "Operations", status: "accepted" },
    { source: "defectdojo", title: "Missing security headers on customer portal", severity: "low", asset: "customer-portal", dept: "IT", status: "resolved" },
    { source: "semgrep", title: "Hardcoded credentials in test config", severity: "high", asset: "repo: kyc-api", dept: "IT", status: "false_positive" },
  ];
  const findRows = findDefs.map((f, i) => ({
    organization_id: orgId,
    source: f.source,
    external_id: `seed-${f.source}-${i}`,
    title: f.title,
    description: "",
    severity: f.severity,
    asset: f.asset,
    department: f.dept,
    raw_payload: { scanner: f.source, seed: true },
    first_seen_at: isoMinus(7 - (i % 5)),
    last_seen_at: isoMinus(1),
    status: f.status,
  }));
  const findings = await must("insert findings", db.from("integration_findings").insert(findRows).select("id"));
  console.log(`Security findings: ${findings.length}`);

  // 10. Notifications (unread)
  const notifRows = [
    { title: "[SEED] VAPT overdue", message: "Quarterly VAPT is overdue by 15 days.", type: "warning" },
    { title: "[SEED] New circular ingested", message: "RBI KYC 2024 amendment processed — 5 obligations extracted.", type: "info" },
    { title: "[SEED] Critical security finding", message: "AWS key detected in repository by gitleaks.", type: "error" },
    { title: "[SEED] Escalation raised", message: "STR monitoring escalated to Compliance.", type: "escalation" },
    { title: "[SEED] Q3 results filed", message: "Quarterly financial results disclosure completed.", type: "success" },
  ].map((n) => ({ ...n, read: false, organization_id: orgId }));
  const notifs = await must("insert notifications", db.from("notifications").insert(notifRows).select("id"));
  console.log(`Notifications: ${notifs.length}`);

  console.log("\nSeed complete.");
}

main().catch((err) => {
  console.error("SEED FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
