/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Enterprise seed: 1 Founder + multiple Banks (tenants), each with a Bank Manager,
 * departments, teams, and a few users + obligations. Idempotent.
 *
 * Usage: node scripts/seed-enterprise.cjs
 * Needs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Credentials created:
 *   Founder         founder@suraksha.local        / SurakshaFounder@2026
 *   <Bank> Manager  manager@<slug>.suraksha.local / SurakshaManager@2026
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
for (const line of (fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/) : [])) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i === -1) continue;
  const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const FOUNDER = { email: "founder@suraksha.local", password: "SurakshaFounder@2026", name: "Platform Founder" };
const BANKS = [
  { name: "HDFC Bank", slug: "hdfc-bank", region: "India" },
  { name: "ICICI Bank", slug: "icici-bank", region: "India" },
  { name: "Axis Bank", slug: "axis-bank", region: "India" },
];
const DEPARTMENTS = [
  { name: "Compliance", risk_level: "high" }, { name: "Risk Management", risk_level: "high" },
  { name: "IT", risk_level: "medium" }, { name: "Security", risk_level: "high" },
  { name: "Operations", risk_level: "medium" }, { name: "Internal Audit", risk_level: "high" },
];

let cachedUsers = null;
async function findUser(email) {
  if (!cachedUsers) cachedUsers = (await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users;
  return cachedUsers.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}
async function ensureUser(email, password, name) {
  let u = await findUser(email);
  if (!u) {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    u = data.user; cachedUsers.push(u);
  }
  return u.id;
}
async function ensureMember(orgId, userId, role, department) {
  await db.from("profiles").upsert({ id: userId, email: (await findUser2(userId)), full_name: null, current_org_id: orgId, default_persona: role }, { onConflict: "id" });
  await db.from("organization_members").upsert({ organization_id: orgId, user_id: userId, role, department: department ?? null, status: "active" }, { onConflict: "organization_id,user_id,role" });
}
async function findUser2(id) {
  if (!cachedUsers) cachedUsers = (await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users;
  return (cachedUsers.find((u) => u.id === id)?.email) || null;
}
const daysFromNow = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log("Seeding enterprise tenants...");

  // 1. Founder
  const founderId = await ensureUser(FOUNDER.email, FOUNDER.password, FOUNDER.name);
  await db.from("profiles").upsert({ id: founderId, email: FOUNDER.email, full_name: FOUNDER.name, default_persona: "founder" }, { onConflict: "id" });
  await db.from("founders").upsert({ id: founderId, email: FOUNDER.email, full_name: FOUNDER.name }, { onConflict: "id" });
  console.log(`Founder: ${FOUNDER.email}`);

  // 2. Banks
  for (const bank of BANKS) {
    const { data: org } = await db.from("organizations").upsert(
      { name: bank.name, slug: bank.slug, status: "active", region: bank.region, created_by: founderId, manager_email: `manager@${bank.slug}.suraksha.local` },
      { onConflict: "slug" }
    ).select("id").single();
    const orgId = org.id;

    // departments
    for (const d of DEPARTMENTS) {
      await db.from("departments").upsert({ organization_id: orgId, name: d.name, risk_level: d.risk_level }, { onConflict: "organization_id,name" });
    }
    // teams
    await db.from("teams").upsert({ organization_id: orgId, name: "SOC Team" }, { onConflict: "organization_id,name" });

    // regulatory feed subscriptions (RegWatcher / MonitoringAgent sources)
    const FEEDS = [
      { slot: "rbi_notifications", regulator: "RBI", feed_url: "https://www.rbi.org.in/notifications_rss.xml", source_type: "rss" },
      { slot: "sebi_rss", regulator: "SEBI", feed_url: "https://www.sebi.gov.in/sebirss.xml", source_type: "rss" },
      { slot: "cert_in", regulator: "CERT-IN", feed_url: "https://www.cert-in.org.in/", source_type: "html" },
      { slot: "npci", regulator: "NPCI", feed_url: "https://www.npci.org.in/what-we-do/upi/circular", source_type: "html" },
      { slot: "uidai", regulator: "UIDAI", feed_url: "https://uidai.gov.in/en/about-uidai/legal-framework/circulars.html", source_type: "html" },
    ];
    for (const f of FEEDS) {
      await db.from("regulatory_sources").upsert(
        {
          organization_id: orgId,
          catalog_slot_id: f.slot,
          regulator: f.regulator,
          feed_url: f.feed_url,
          source_type: f.source_type,
          enabled: true,
        },
        { onConflict: "organization_id,catalog_slot_id" }
      );
    }

    // manager + a couple of users
    const mgrEmail = `manager@${bank.slug}.suraksha.local`;
    const mgrId = await ensureUser(mgrEmail, "SurakshaManager@2026", `${bank.name} Manager`);
    await ensureMember(orgId, mgrId, "bank_manager", null);

    const compId = await ensureUser(`compliance@${bank.slug}.suraksha.local`, "SurakshaUser@2026", "Compliance Lead");
    await ensureMember(orgId, compId, "compliance_admin", "Compliance");
    const secId = await ensureUser(`security@${bank.slug}.suraksha.local`, "SurakshaUser@2026", "Security Lead");
    await ensureMember(orgId, secId, "security_team", "Security");

    // a few obligations for stats (idempotent by reference)
    const obls = [
      { ref: `ENT-${bank.slug}-1`, title: "KYC periodic review", department: "Compliance", status: "compliant", priority: "high" },
      { ref: `ENT-${bank.slug}-2`, title: "Cyber incident reporting", department: "IT", status: "in_progress", priority: "critical" },
      { ref: `ENT-${bank.slug}-3`, title: "VAPT quarterly", department: "Security", status: "overdue", priority: "high" },
      { ref: `ENT-${bank.slug}-4`, title: "Capital adequacy filing", department: "Risk Management", status: "compliant", priority: "medium" },
    ];
    for (const o of obls) {
      await db.from("obligations").upsert({
        reference: `SEED-${o.ref}`, title: o.title, description: o.title, regulation: "RBI", jurisdiction: "India",
        department: o.department, owner: "Team", status: o.status, priority: o.priority, due_date: daysFromNow(30),
        confidence_score: 90, organization_id: orgId, created_by: compId, review_status: "approved",
      }, { onConflict: "reference" });
    }
    console.log(`Bank: ${bank.name} (manager ${mgrEmail})`);
  }

  console.log("\nEnterprise seed complete.");
  console.log("Login as founder: founder@suraksha.local / SurakshaFounder@2026");
}

main().catch((e) => { console.error("SEED FAILED:", e instanceof Error ? e.message : String(e)); process.exit(1); });
