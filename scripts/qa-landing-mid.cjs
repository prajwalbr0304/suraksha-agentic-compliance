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
  // incremental scroll to trigger whileInView reveals like a real user
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= h; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const dir = path.join(__dirname, "..", "test-results");
  // capture the loop + features region
  await page.evaluate(() => document.getElementById("loop")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(dir, "landing-loop.png") });
  await page.evaluate(() => document.getElementById("features")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(dir, "landing-features.png") });
  console.log("saved landing-loop.png + landing-features.png");
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
