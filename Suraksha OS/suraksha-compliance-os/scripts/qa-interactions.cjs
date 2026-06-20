/* eslint-disable */
// Focused interaction probe for key pages: clicks real tabs/buttons/modals,
// types in search, and records console errors triggered by interactions.
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "http://localhost:3000";
const TENANT = "test-cooperative-bank";
const EMAIL = "manager@testbank.com";
const PASSWORD = "anekal123";
const OUT = path.join(__dirname, "..", "test-results", "qa-screens");
const RESULT = path.join(__dirname, "..", "test-results", "qa-interactions.json");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
let cur = "global";
const rec = (k) => (out[k] = out[k] || { errors: [], steps: [] });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  page.on("console", (m) => {
    if (m.type() === "error") rec(cur).errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => rec(cur).errors.push("PAGEERROR " + String(e).slice(0, 200)));

  // login
  cur = "login";
  rec(cur);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible" });
  await sleep(2500);
  await page.locator("#email").click();
  await page.locator("#email").type(EMAIL, { delay: 12 });
  await page.locator("#password").click();
  await page.locator("#password").type(PASSWORD, { delay: 12 });
  await page.getByRole("button", { name: /Sign in/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await sleep(2500);
  rec(cur).steps.push("login ok -> " + page.url());

  async function go(p) {
    await page.goto(`${BASE}/dashboard/${TENANT}/${p}`, { waitUntil: "domcontentloaded" });
    await sleep(3500);
  }
  async function clickByText(text, label) {
    try {
      const el = page.getByText(text, { exact: false }).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click({ timeout: 4000 });
        await sleep(1200);
        rec(cur).steps.push(`clicked "${label || text}" ok`);
        return true;
      }
    } catch (e) {
      rec(cur).steps.push(`click "${label || text}" FAIL: ${String(e).slice(0, 100)}`);
    }
    return false;
  }
  async function clickButton(name, label) {
    try {
      const el = page.getByRole("button", { name }).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click({ timeout: 4000 });
        await sleep(1200);
        rec(cur).steps.push(`button "${label || name}" ok`);
        return true;
      }
    } catch (e) {
      rec(cur).steps.push(`button "${label || name}" FAIL: ${String(e).slice(0, 100)}`);
    }
    return false;
  }
  async function shot(name) {
    await page.screenshot({ path: path.join(OUT, `int-${name}.png`), fullPage: true }).catch(() => {});
  }

  // ── Regulation Center: 4 tabs + add/edit modal + escape close ──
  cur = "regulation-center";
  rec(cur);
  await go("regulation-center");
  for (const t of ["Regulation Sources", "Extracted Regulations", "Monitor", "Logs"]) {
    await clickByText(t, `tab:${t}`);
    await shot("regctr-" + t.replace(/\s+/g, "_").toLowerCase());
  }
  // back to sources, try Edit (opens dialog), close with Escape
  await clickByText("Regulation Sources", "tab:Sources");
  if (await clickButton(/^Edit$/, "Edit source")) {
    const dlg = page.locator('[role="dialog"]').first();
    const open = await dlg.isVisible().catch(() => false);
    rec(cur).steps.push(open ? "edit dialog opened" : "edit dialog NOT shown");
    await shot("regctr-editdialog");
    await page.keyboard.press("Escape");
    await sleep(800);
    rec(cur).steps.push((await dlg.isVisible().catch(() => false)) ? "escape close FAILED" : "escape close ok");
  }
  // Extracted -> sub-pills
  await clickByText("Extracted Regulations", "tab:Extracted");
  for (const pill of ["approved", "rejected", "completed", "failed"]) {
    await clickByText(pill, `pill:${pill}`);
  }

  // ── Settings: tabs ──
  cur = "settings";
  rec(cur);
  await go("settings");
  await shot("settings");
  for (const t of ["General", "Notifications", "Security", "Organization", "Profile", "Integrations"]) {
    await clickByText(t, `settings-tab:${t}`);
  }

  // ── Documents: search + buttons ──
  cur = "documents";
  rec(cur);
  await go("documents");
  await page.screenshot({ path: path.join(OUT, "int-documents.png"), fullPage: true }).catch(() => {});
  try {
    const search = page.locator('input[placeholder*="earch" i], input[type="search"]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("circular");
      await sleep(1200);
      rec(cur).steps.push("search typed ok");
      await search.fill("");
    } else rec(cur).steps.push("no search input found");
  } catch (e) {
    rec(cur).steps.push("search FAIL " + String(e).slice(0, 80));
  }

  // ── Obligations: open first row/detail ──
  cur = "obligations";
  rec(cur);
  await go("obligations");
  await clickButton(/filter|status|category/i, "filter");
  await shot("obligations");

  // ── Agents: status + controls present (do NOT trigger long run) ──
  cur = "agents";
  rec(cur);
  await go("agents");
  const agentText = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n/g, " | "));
  rec(cur).steps.push("agents body: " + agentText.slice(0, 200));
  await shot("agents");

  fs.writeFileSync(RESULT, JSON.stringify(out, null, 2));
  await browser.close();
  console.log("INTERACTIONS_DONE");
})().catch((e) => {
  console.error("INT_ERR", e);
  try {
    fs.writeFileSync(RESULT, JSON.stringify(out, null, 2));
  } catch {}
  process.exit(1);
});
