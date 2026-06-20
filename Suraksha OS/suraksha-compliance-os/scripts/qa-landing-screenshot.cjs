/* eslint-disable */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = "http://localhost:3000";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const dir = path.join(__dirname, "..", "test-results");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, "landing-hero.png") });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "landing-full.png"), fullPage: true });
  console.log("saved landing-hero.png + landing-full.png");
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
