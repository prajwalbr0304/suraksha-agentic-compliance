/* eslint-disable */
const { chromium } = require("@playwright/test");
const BASE = "http://localhost:3000";
const TENANT = "test-cooperative-bank";
const EMAIL = "manager@testbank.com";
const PASSWORD = "anekal123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  const apiCalls = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/")) apiCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible" });
  await sleep(2500);
  await page.locator("#email").click();
  await page.locator("#email").type(EMAIL, { delay: 15 });
  await page.locator("#password").click();
  await page.locator("#password").type(PASSWORD, { delay: 15 });
  await page.getByRole("button", { name: /Sign in/i }).first().click();
  await page.waitForURL(/\/(founder|dashboard)/, { timeout: 60000 });
  await sleep(3000);
  console.log("AFTER_LOGIN_URL:", page.url());

  const lsKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.includes("auth") || k.includes("sb-")),
  );
  console.log("LOCALSTORAGE_AUTH_KEYS:", JSON.stringify(lsKeys));

  // Read token and call /api/me with Bearer from page context
  const meStatus = await page.evaluate(async () => {
    let token = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.endsWith("-auth-token")) {
        try {
          token = JSON.parse(localStorage.getItem(k)).access_token;
        } catch {}
      }
    }
    const res = await fetch("/api/me", { headers: token ? { Authorization: "Bearer " + token } : {} });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, hasToken: !!token, body: JSON.stringify(body).slice(0, 300) };
  });
  console.log("API_ME_WITH_BEARER:", JSON.stringify(meStatus));

  // Now navigate to tenant compliance (hard nav)
  await page.goto(`${BASE}/dashboard/${TENANT}/compliance`, { waitUntil: "domcontentloaded" });
  await sleep(6000);
  console.log("TENANT_NAV_FINAL_URL:", page.url());
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, " | "));
  console.log("TENANT_PAGE_TEXT:", txt);

  // Does localStorage survive the nav?
  const stillHasToken = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.endsWith("-auth-token")) return true;
    }
    return false;
  });
  console.log("TOKEN_SURVIVES_NAV:", stillHasToken);

  console.log("API_CALLS:", JSON.stringify(apiCalls.slice(-15), null, 0));
  await browser.close();
})();
