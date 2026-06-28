/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Suraksha OS — full showcase capture.
 *
 * Captures: public pages, founder multi-tenant console (with org drill-down),
 * manager/admin workspace, and every role persona — full-page screenshots plus
 * tab/dialog interactions, and a recorded guided demo video (founder + manager).
 *
 * Usage:
 *   npm run dev            # in another terminal (http://localhost:3000)
 *   node scripts/showcase-capture.cjs
 *
 * Env:
 *   SHOWCASE_BASE_URL   default http://localhost:3000
 *   SHOWCASE_HEADLESS   default "true" ("false" to watch)
 *   SHOWCASE_ONLY       optional comma list of group keys to run (public,founder,manager,roles)
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
let ffmpegPath = null;
try { ffmpegPath = require("@ffmpeg-installer/ffmpeg").path; } catch {}

const root = process.cwd();
const baseURL = process.env.SHOWCASE_BASE_URL || "http://localhost:3000";
const headless = process.env.SHOWCASE_HEADLESS !== "false";
const only = (process.env.SHOWCASE_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const outRoot = path.join(root, "docs", "showcase");
const shotsDir = path.join(outRoot, "screenshots");
const videoDir = path.join(outRoot, "video");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
}
loadEnv();

const ORG_HDFC = "bf70f6b5-98ba-4588-aaf0-ee36c1d1477a"; // HDFC Bank — founder drill target

const FOUNDER = { email: "founder@suraksha.local", password: "SurakshaFounder@2026" };
const MANAGER = { email: "manager@testbank.com", password: "anekal123" };
const ROLE_USERS = [
  { key: "compliance-analyst", name: "Priya Shah", email: "priya.shah@yourbank.test", password: "anekal123", role: "Compliance Analyst" },
  { key: "security-team", name: "Alex Chen", email: "alex.chen@yourbank.test", password: "anekal123", role: "Security Team" },
  { key: "it-owner", name: "Sam Lee", email: "sam.lee@yourbank.test", password: "anekal123", role: "IT Owner" },
  { key: "internal-auditor", name: "Jordan Kim", email: "jordan.kim@yourbank.test", password: "anekal123", role: "Internal Auditor" },
  { key: "executive-viewer", name: "Riley Park", email: "riley.park@yourbank.test", password: "anekal123", role: "Executive Viewer" },
];

// Tenant workspace module path segments (appended to /dashboard/{slug}).
const ROLE_DASHBOARDS = ["", "compliance", "executive", "audit", "security", "team"];
const MODULES = [
  "upload", "documents", "regulation-center", "obligations", "map-board", "my-tasks",
  "knowledge-graph", "drift", "readiness", "evidence", "impact", "security-findings",
  "reports", "agents", "settings", "analytics",
  "admin/users", "admin/departments", "admin/teams", "admin/access",
];

// Founder console routes.
const FOUNDER_ROUTES = [
  { seg: "/founder", name: "01-dashboard" },
  { seg: "/founder/organizations", name: "02-organizations" },
  { seg: "/founder/managers", name: "03-managers" },
  { seg: "/founder/users", name: "04-users" },
  { seg: "/founder/access", name: "05-access-control" },
  { seg: "/analytics", name: "06-analytics" },
  { seg: "/reports", name: "07-reports" },
  { seg: "/audit", name: "08-audit-trail" },
  { seg: "/agents", name: "09-agents" },
  { seg: "/settings", name: "10-settings" },
];
const FOUNDER_ORG_SUBPAGES = [
  "", "obligations", "documents", "upload", "map-board", "knowledge-graph",
  "drift", "readiness", "evidence", "impact", "security-findings",
  "audit", "users", "teams", "departments", "access",
];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function slug(s) { return s.replace(/[^a-z0-9/]+/gi, "-").replace(/\/+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "home"; }

async function settle(page, ms = 1000) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Wait until the authenticated app shell finishes the "Checking secure session" gate. */
async function waitForShell(page) {
  await page.waitForFunction(() => {
    const t = document.body.innerText || "";
    if (/Checking secure session/i.test(t)) return false;
    return !!document.querySelector("aside") || /Access denied|could not be found|This page could not/i.test(t);
  }, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** Scroll through the page to trigger whileInView / lazy content, then return to top. */
async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      const sleep = (t) => new Promise((r) => setTimeout(r, t));
      const h = document.body.scrollHeight;
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < h; y += step) { window.scrollTo(0, y); await sleep(120); }
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(300);
      window.scrollTo(0, 0);
      await sleep(250);
    });
  } catch {}
}

async function shot(page, group, name) {
  const dir = path.join(shotsDir, group);
  ensureDir(dir);
  const file = path.join(dir, `${name}.png`);
  await autoScroll(page);
  await page.screenshot({ path: file, fullPage: true }).catch(async () => {
    await page.screenshot({ path: file }).catch(() => {});
  });
  const rel = path.relative(root, file).replace(/\\/g, "/");
  console.log(`  shot ${rel}`);
  return rel;
}

async function isAccessDenied(page) {
  const txt = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  return /Access denied/i.test(txt) && /cannot access this page|current role/i.test(txt);
}
async function isNotFound(page) {
  const txt = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  return /This page could not be found|404/i.test(txt);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROJECT_REF = new URL(SB_URL).hostname.split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

async function signIn(user) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data, error } = await sb.auth.signInWithPassword({ email: user.email, password: user.password });
    if (!error && data.session?.access_token) return data.session;
    console.warn(`  signIn attempt ${attempt} for ${user.email}: ${error?.message || "no session"}`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`Supabase login failed for ${user.email}`);
}

/**
 * Robust login: type credentials for the recording, then inject the Supabase
 * session into localStorage (avoids the dev-server hydration race that makes the
 * form submit natively) and land on the destination so the app shell loads.
 */
async function login(page, user, dest = "/dashboard") {
  const session = await signIn(user);
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /welcome back/i }).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page.locator("#email").fill(user.email).catch(() => {});
  await page.locator("#password").fill(user.password).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(({ key, value }) => { window.localStorage.setItem(key, JSON.stringify(value)); }, { key: STORAGE_KEY, value: session });
  await page.goto(`${baseURL}${dest}`, { waitUntil: "domcontentloaded" });
  await page.locator("aside").first().waitFor({ state: "visible", timeout: 60000 });
  await waitForShell(page);
  await settle(page, 1200);
  return page.url();
}

async function logout(page, context) {
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
  await context.clearCookies().catch(() => {});
}

function tenantBaseFromUrl(url) {
  const m = url.match(/\/dashboard\/([^/?#]+)/);
  return m ? `/dashboard/${m[1]}` : "/dashboard";
}

/** Best-effort: click tabs on a page and capture each tab state. */
async function captureTabs(page, group, baseName) {
  try {
    const tabs = page.locator('[role="tab"]');
    const n = Math.min(await tabs.count().catch(() => 0), 6);
    for (let i = 0; i < n; i++) {
      const tab = tabs.nth(i);
      const label = (await tab.innerText().catch(() => "")).trim().slice(0, 24) || `tab-${i}`;
      const selected = await tab.getAttribute("aria-selected").catch(() => null);
      if (selected === "true") continue;
      await tab.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      await shot(page, group, `${baseName}--tab-${slug(label)}`);
    }
  } catch {}
}

/** Best-effort: open the first "New …" / "Add …" / "Create …" dialog and capture it. */
async function captureCreateDialog(page, group, baseName) {
  try {
    const btn = page.getByRole("button", { name: /^(new|add|create|invite)\b/i }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.count().catch(() => 0)) {
        await shot(page, group, `${baseName}--dialog`);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
      }
    }
  } catch {}
}

async function gotoReady(page, url, auth) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(`${baseURL}${url}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      if (auth) await waitForShell(page);
      await settle(page);
      return true;
    } catch (e) {
      console.warn(`  goto attempt ${attempt} ${url}: ${e.message}`);
      if (attempt === 2) return false;
      await page.waitForTimeout(1500);
    }
  }
  return false;
}

async function visit(page, group, name, url, { tabs = false, dialog = false, auth = true } = {}) {
  try {
    const ok0 = await gotoReady(page, url, auth);
    if (!ok0) { await shot(page, group, name).catch(() => {}); return { ok: false, error: "goto failed" }; }
    if (await isNotFound(page)) { console.log(`  skip (404) ${url}`); return { ok: false, denied: false, notFound: true }; }
    if (await isAccessDenied(page)) { console.log(`  rbac-denied ${url}`); return { ok: false, denied: true }; }
    const rel = await shot(page, group, name);
    if (tabs) await captureTabs(page, group, name);
    if (dialog) await captureCreateDialog(page, group, name);
    return { ok: true, rel };
  } catch (e) {
    console.warn(`  visit error ${url}: ${e.message}`);
    await shot(page, group, name).catch(() => {});
    return { ok: false, error: e.message };
  }
}

async function capturePublic(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  console.log("\n=== PUBLIC ===");
  await visit(page, "00-public", "01-landing", "/", { auth: false });
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await shot(page, "00-public", "02-login");
  await context.close();
}

async function captureFounderAndManager(browser) {
  // Recorded context — produces the guided demo video.
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.25,
    recordVideo: { dir: videoDir, size: { width: 1600, height: 1000 } },
  });
  const page = await context.newPage();

  if (!only.length || only.includes("founder")) {
    console.log("\n=== FOUNDER (multi-tenant console) ===");
    await login(page, FOUNDER, "/founder");
    for (const r of FOUNDER_ROUTES) {
      await visit(page, "founder", r.name, r.seg, { tabs: true });
    }
    // Drill into one organization — full sub-page set.
    console.log("  -- org drill-down (HDFC Bank) --");
    for (let i = 0; i < FOUNDER_ORG_SUBPAGES.length; i++) {
      const sub = FOUNDER_ORG_SUBPAGES[i];
      const seg = `/founder/organizations/${ORG_HDFC}${sub ? "/" + sub : ""}`;
      const nm = `org-${String(i + 1).padStart(2, "0")}-${sub || "overview"}`;
      await visit(page, "founder", nm, seg, { tabs: true });
    }
  }

  if (!only.length || only.includes("manager")) {
    console.log("\n=== MANAGER / ADMIN (Test Cooperative Bank) ===");
    await logout(page, context);
    const url = await login(page, MANAGER, "/dashboard");
    const base = tenantBaseFromUrl(url);
    let idx = 0;
    for (const d of ROLE_DASHBOARDS) {
      const seg = `${base}${d ? "/" + d : ""}`;
      const nm = `${String(++idx).padStart(2, "0")}-dashboard-${d || "home"}`;
      await visit(page, "manager", nm, seg, { tabs: true });
    }
    for (const m of MODULES) {
      const seg = `${base}/${m}`;
      const nm = `${String(++idx).padStart(2, "0")}-${slug(m)}`;
      const isAdmin = m.startsWith("admin/");
      await visit(page, "manager", nm, seg, { tabs: true, dialog: isAdmin });
    }
  }

  await page.waitForTimeout(800);
  const videoPath = await page.video()?.path().catch(() => null);
  await context.close(); // finalizes video
  if (videoPath && fs.existsSync(videoPath)) {
    const dest = path.join(videoDir, "suraksha-demo.webm");
    try { fs.renameSync(videoPath, dest); } catch { fs.copyFileSync(videoPath, dest); }
    console.log(`\n  demo video -> ${path.relative(root, dest).replace(/\\/g, "/")}`);
    convertVideo(dest);
  }
}

function convertVideo(webm) {
  if (!ffmpegPath) { console.warn("  ffmpeg not available — keeping .webm only"); return; }
  const mp4 = path.join(videoDir, "suraksha-demo.mp4");
  const gif = path.join(videoDir, "suraksha-demo.gif");
  const palette = path.join(videoDir, "_palette.png");
  console.log("  converting demo video (mp4 + gif)…");
  const run = (args) => spawnSync(ffmpegPath, ["-y", ...args], { stdio: "ignore" });
  run(["-i", webm, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", "scale=1366:-2", "-c:v", "libx264", "-crf", "25", "-an", mp4]);
  // GIF preview: 12fps, 980px wide, palette for quality/size.
  run(["-i", webm, "-vf", "fps=12,scale=980:-1:flags=lanczos,palettegen", palette]);
  run(["-i", webm, "-i", palette, "-lavfi", "fps=12,scale=980:-1:flags=lanczos[x];[x][1:v]paletteuse", gif]);
  try { fs.unlinkSync(palette); } catch {}
  for (const f of [mp4, gif]) {
    if (fs.existsSync(f)) console.log(`  -> ${path.relative(root, f).replace(/\\/g, "/")} (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);
  }
}

async function captureRoleUser(browser, user) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  console.log(`\n=== ROLE: ${user.role} (${user.name}) ===`);
  const group = path.join("roles", user.key);
  try {
    const url = await login(page, user, "/dashboard");
    const base = tenantBaseFromUrl(url);
    let idx = 0;
    // Landing dashboard first.
    await visit(page, group, `${String(++idx).padStart(2, "0")}-home`, base, { tabs: true });
    for (const d of ROLE_DASHBOARDS) {
      if (!d) continue;
      await visit(page, group, `${String(++idx).padStart(2, "0")}-dashboard-${d}`, `${base}/${d}`, { tabs: true });
    }
    for (const m of MODULES) {
      await visit(page, group, `${String(++idx).padStart(2, "0")}-${slug(m)}`, `${base}/${m}`, { tabs: true });
    }
  } catch (e) {
    console.error(`  role ${user.key} failed: ${e.message}`);
  } finally {
    await context.close();
  }
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    try { const r = await fetch(baseURL); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`App not reachable at ${baseURL}. Run: npm run dev`);
}

async function main() {
  ensureDir(shotsDir);
  ensureDir(videoDir);
  await waitForServer();
  const browser = await chromium.launch({ headless });
  try {
    if (!only.length || only.includes("public")) await capturePublic(browser);
    if (!only.length || only.includes("founder") || only.includes("manager")) await captureFounderAndManager(browser);
    if (!only.length || only.includes("roles")) {
      for (const u of ROLE_USERS) await captureRoleUser(browser, u);
    }
  } finally {
    await browser.close();
  }
  console.log("\nDONE. Screenshots in docs/showcase/screenshots, video in docs/showcase/video.");
}

main().catch((e) => { console.error(e); process.exit(1); });
