/* eslint-disable */
// Standalone E2E QA harness for Suraksha Compliance OS.
// Drives real Chromium via Playwright, captures console + network + screenshots
// for every route, runs interaction probes, and writes a JSON result file.
//
// NON-DESTRUCTIVE: only deletes entities it created itself (tagged QA_*).
// Does NOT block on long-running agent/obligation extraction (Ollama ~10min).

const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const TENANT = "test-cooperative-bank";
const EMAIL = process.env.QA_EMAIL || "manager@testbank.com";
const PASSWORD = process.env.QA_PASSWORD || "anekal123";

const OUT_DIR = path.join(__dirname, "..", "test-results", "qa-screens");
const RESULT_JSON = path.join(__dirname, "..", "test-results", "qa-results.json");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ROUTES = [
  { n: 1, name: "Dashboard", path: "compliance" },
  { n: 2, name: "Upload", path: "upload" },
  { n: 3, name: "Documents", path: "documents" },
  { n: 4, name: "Regulation Center", path: "regulation-center" },
  { n: 5, name: "Obligations", path: "obligations" },
  { n: 6, name: "Compliance Action Board", path: "map-board" },
  { n: 7, name: "My Tasks", path: "my-tasks" },
  { n: 8, name: "Knowledge Graph", path: "knowledge-graph" },
  { n: 9, name: "Regulatory Change Analysis", path: "drift" },
  { n: 10, name: "Readiness", path: "readiness" },
  { n: 11, name: "Evidence", path: "evidence" },
  { n: 12, name: "Compliance Impact Analysis", path: "impact" },
  { n: 13, name: "Security Findings", path: "security-findings" },
  { n: 14, name: "Reports", path: "reports" },
  { n: 15, name: "Audit Trail", path: "audit" },
  { n: 16, name: "Agents", path: "agents" },
  { n: 17, name: "Users (Admin)", path: "admin/users" },
  { n: 18, name: "Departments (Admin)", path: "admin/departments" },
  { n: 19, name: "Teams (Admin)", path: "admin/teams" },
  { n: 20, name: "Access Control (Admin)", path: "admin/access" },
  { n: 21, name: "Settings", path: "settings" },
];

const results = {};
let current = null; // route key for tagging events

function rec(routeKey) {
  if (!results[routeKey]) {
    results[routeKey] = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      networkErrors: [],
      notes: [],
      interactions: [],
    };
  }
  return results[routeKey];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safe(fn, label, routeKey) {
  try {
    return await fn();
  } catch (e) {
    rec(routeKey).notes.push(`[probe-fail] ${label}: ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function gotoIdle(page, url, routeKey, timeout = 45000) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  } catch (e) {
    rec(routeKey).notes.push(`[goto] ${String(e).slice(0, 160)}`);
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: 12000 });
  } catch {
    /* networkidle may never settle with polling; ignore */
  }
  await sleep(1200);
}

async function analyzePage(page, routeKey) {
  const r = rec(routeKey);
  // blank / skeleton / data signals
  const info = await safe(
    () =>
      page.evaluate(() => {
        const bodyText = (document.body.innerText || "").trim();
        const skeletons = document.querySelectorAll(".animate-pulse, [data-skeleton]").length;
        const h1 = document.querySelector("h1")?.innerText?.trim() || "";
        // active sidebar item (has accent classes from this app)
        const activeNav =
          Array.from(document.querySelectorAll("aside a, nav a"))
            .filter((a) => /text-\[#b0c6ff\]|bg-\[#|active/.test(a.className) && a.innerText.trim())
            .map((a) => a.innerText.trim())[0] || "";
        const hasNaN = /(\bNaN\b|undefined|\[object Object\])/.test(bodyText);
        return { len: bodyText.length, skeletons, h1, activeNav, hasNaN, sample: bodyText.slice(0, 140) };
      }),
    "analyze",
    routeKey,
  );
  if (info) {
    r.h1 = info.h1;
    r.activeNav = info.activeNav;
    r.bodyLen = info.len;
    r.skeletons = info.skeletons;
    if (info.len < 40) r.notes.push(`[BLANK] body text length=${info.len}`);
    if (info.hasNaN) r.notes.push(`[BAD-RENDER] body contains NaN/undefined/[object Object]`);
    if (info.skeletons > 0) r.notes.push(`[skeleton] ${info.skeletons} skeleton elems still present after load`);
  }
}

async function probeInteractions(page, routeKey) {
  const r = rec(routeKey);
  // Tabs (role=tab) and pill/tab-like buttons
  const tabSel = '[role="tab"]';
  const tabs = await safe(() => page.locator(tabSel).all(), "list-tabs", routeKey);
  if (tabs && tabs.length) {
    for (let i = 0; i < Math.min(tabs.length, 8); i++) {
      await safe(async () => {
        const t = page.locator(tabSel).nth(i);
        if (await t.isVisible()) {
          const label = (await t.innerText().catch(() => "")).slice(0, 40);
          await t.click({ timeout: 4000 });
          await sleep(500);
          r.interactions.push(`tab:"${label}" ok`);
        }
      }, `tab-${i}`, routeKey);
    }
  }

  // Filter selects: change to last option then back
  const selects = await safe(() => page.locator("select:visible").all(), "list-selects", routeKey);
  if (selects && selects.length) {
    for (let i = 0; i < Math.min(selects.length, 4); i++) {
      await safe(async () => {
        const s = page.locator("select:visible").nth(i);
        const opts = await s.locator("option").count();
        if (opts > 1) {
          await s.selectOption({ index: opts - 1 }, { timeout: 4000 });
          await sleep(400);
          await s.selectOption({ index: 0 }, { timeout: 4000 }).catch(() => {});
          r.interactions.push(`select#${i} (${opts} opts) ok`);
        }
      }, `select-${i}`, routeKey);
    }
  }

  // Open a modal/dialog via the first safe-looking trigger, then close via Escape.
  // Safe triggers exclude destructive words.
  const triggers = await safe(
    () =>
      page
        .locator(
          'button:has-text("Add"), button:has-text("New"), button:has-text("Create"), button:has-text("Configure"), button:has-text("Filter")',
        )
        .all(),
    "list-triggers",
    routeKey,
  );
  if (triggers && triggers.length) {
    await safe(async () => {
      const t = triggers[0];
      const label = (await t.innerText().catch(() => "")).slice(0, 30);
      if (await t.isVisible()) {
        await t.click({ timeout: 4000 });
        await sleep(700);
        const dialog = page.locator('[role="dialog"]').first();
        const opened = await dialog.isVisible().catch(() => false);
        if (opened) {
          r.interactions.push(`modal via "${label}" opened`);
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(400);
          const stillOpen = await dialog.isVisible().catch(() => false);
          r.interactions.push(stillOpen ? `modal Escape-close FAILED` : `modal Escape-close ok`);
          // force-close if needed
          if (stillOpen) {
            await page.locator('[role="dialog"] button:has-text("Cancel"), [role="dialog"] [aria-label="Close"]').first().click({ timeout: 2000 }).catch(() => {});
          }
        } else {
          r.interactions.push(`trigger "${label}" clicked (no dialog detected)`);
        }
      }
    }, "modal-open-close", routeKey);
  }

  // Search input: type a query (non-destructive)
  await safe(async () => {
    const search = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("test", { timeout: 3000 });
      await sleep(600);
      await search.fill("", { timeout: 3000 }).catch(() => {});
      r.interactions.push("search input ok");
    }
  }, "search", routeKey);

  // Count clickable buttons (informational)
  const btnCount = await safe(() => page.locator("button:visible").count(), "count-buttons", routeKey);
  if (typeof btnCount === "number") r.notes.push(`[ui] ${btnCount} visible buttons`);
}

async function testRoute(page, route) {
  const key = `${route.n}. ${route.name}`;
  current = key;
  rec(key);
  const url = `${BASE}/dashboard/${TENANT}/${route.path}`;
  rec(key).url = url;
  await gotoIdle(page, url, key);
  await analyzePage(page, key);
  rec(key).finalUrl = page.url();
  if (!page.url().includes(route.path.split("/")[0])) {
    rec(key).notes.push(`[redirect] landed on ${page.url()}`);
  }
  await probeInteractions(page, key);
  // screenshot
  await safe(
    () => page.screenshot({ path: path.join(OUT_DIR, `${String(route.n).padStart(2, "0")}-${route.path.replace(/\//g, "_")}.png`), fullPage: true }),
    "screenshot",
    key,
  );
  // refresh test
  await safe(async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1500);
    const stillAuthed = !page.url().includes("/login");
    rec(key).notes.push(stillAuthed ? "[refresh] survived reload, auth kept" : "[refresh] LOST AUTH after reload");
  }, "refresh", key);
}

async function crossCutting(page) {
  const key = "X. Cross-cutting";
  current = key;
  rec(key);

  // Sidebar rail/panel toggle (collapse button)
  await safe(async () => {
    const collapse = page.locator('button[title*="ollapse" i], aside button:has(svg)').first();
    rec(key).notes.push("[sidebar] present=" + (await page.locator("aside").count()));
  }, "sidebar", key);

  // Responsive 768
  await safe(async () => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`${BASE}/dashboard/${TENANT}/compliance`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
    rec(key).notes.push(overflow ? "[responsive-768] HORIZONTAL OVERFLOW detected" : "[responsive-768] no horizontal overflow");
    await page.screenshot({ path: path.join(OUT_DIR, "x1-responsive-768.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  }, "responsive", key);

  // Invalid route -> 404
  await safe(async () => {
    await page.goto(`${BASE}/dashboard/${TENANT}/this-route-does-not-exist-zzz`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const txt = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    const is404 = /404|not found|doesn'?t exist|page not found/.test(txt);
    rec(key).notes.push(is404 ? "[404] proper not-found page shown" : `[404] NO not-found page (body: ${txt.slice(0, 80)})`);
    await page.screenshot({ path: path.join(OUT_DIR, "x2-404.png"), fullPage: true });
  }, "404", key);

  // Logout
  await safe(async () => {
    await page.goto(`${BASE}/dashboard/${TENANT}/compliance`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const btn = page.getByRole("button", { name: /sign out|logout/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
      rec(key).notes.push(page.url().includes("/login") ? "[logout] redirected to /login" : `[logout] did not reach /login (at ${page.url()})`);
    } else {
      rec(key).notes.push("[logout] Sign out button not found");
    }
  }, "logout", key);

  // Auth guard after logout
  await safe(async () => {
    await page.goto(`${BASE}/dashboard/${TENANT}/obligations`, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    const guarded = page.url().includes("/login") || /access denied|sign in/i.test(await page.evaluate(() => document.body.innerText));
    rec(key).notes.push(guarded ? "[auth-guard] protected route blocked when logged out" : `[auth-guard] LEAK: rendered without auth at ${page.url()}`);
    await page.screenshot({ path: path.join(OUT_DIR, "x3-authguard.png"), fullPage: true });
  }, "authguard", key);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error") rec(current || "global").consoleErrors.push(msg.text().slice(0, 300));
    else if (type === "warning") rec(current || "global").consoleWarnings.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => rec(current || "global").pageErrors.push(String(err).slice(0, 300)));
  page.on("response", (resp) => {
    const s = resp.status();
    if (s >= 400) {
      const u = resp.url();
      if (u.includes("/_next/") && s === 404) return; // ignore dev asset 404 noise
      rec(current || "global").networkErrors.push(`${s} ${resp.request().method()} ${u.replace(BASE, "")}`.slice(0, 200));
    }
  });

  // ── LOGIN ──
  current = "0. Login";
  rec(current);
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Wait for hydration: the submit button must be enabled and inputs interactive.
    await page.locator("#email").waitFor({ state: "visible", timeout: 30000 });
    await sleep(2500); // allow React hydration to finish before filling controlled inputs
    const emailEl = page.locator("#email");
    const pwEl = page.locator("#password");
    await emailEl.click();
    await emailEl.fill("");
    await emailEl.type(EMAIL, { delay: 15 });
    await pwEl.click();
    await pwEl.fill("");
    await pwEl.type(PASSWORD, { delay: 15 });
    await sleep(400);
    // verify values actually registered in the DOM/React state
    const vals = await page.evaluate(() => ({
      e: document.querySelector("#email")?.value || "",
      p: (document.querySelector("#password")?.value || "").length,
    }));
    rec(current).notes.push(`[login] field check email="${vals.e}" pwLen=${vals.p}`);
    await page.screenshot({ path: path.join(OUT_DIR, "00-login.png"), fullPage: true });
    await page.getByRole("button", { name: /Sign in to workspace|Sign in/i }).first().click();
    await page.waitForURL(/\/(founder|dashboard)/, { timeout: 60000 });
    await sleep(2500);
    rec(current).notes.push(`[login] success, landed at ${page.url()}`);
    rec(current).finalUrl = page.url();
    await page.screenshot({ path: path.join(OUT_DIR, "01-post-login.png"), fullPage: true });
  } catch (e) {
    rec(current).notes.push(`[login] FAILED: ${String(e).slice(0, 220)}`);
    rec(current).finalUrl = page.url();
    await page.screenshot({ path: path.join(OUT_DIR, "00-login-FAIL.png"), fullPage: true }).catch(() => {});
    fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2));
    await browser.close();
    console.log("LOGIN_FAILED");
    process.exit(1);
  }

  // ── PAGE-BY-PAGE ──
  for (const route of ROUTES) {
    await testRoute(page, route);
    fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2)); // incremental save
    console.log(`done: ${route.n}. ${route.name}`);
  }

  // ── CROSS-CUTTING (runs logout last) ──
  await crossCutting(page);

  fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2));
  await browser.close();
  console.log("QA_COMPLETE");
})().catch((e) => {
  console.error("HARNESS_ERROR", e);
  try {
    fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2));
  } catch {}
  process.exit(1);
});
