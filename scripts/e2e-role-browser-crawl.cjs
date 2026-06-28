/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Role-based browser crawl: real UI login (optional session injection), visit every app route
 * per demo user, assert RBAC (Access denied vs shell), capture console errors / failed requests,
 * full-page screenshots, JSON + Markdown report.
 *
 * Keep NAV_ACCESS in sync with data/mock-data.ts navigationItems personas.
 *
 * Usage:
 *   npm run dev   # in another terminal
 *   npm run test:e2e:roles
 *
 * Env:
 *   E2E_BASE_URL       default http://localhost:3000
 *   E2E_HEADLESS       default true; set "false" to watch the browser
 *   E2E_UI_LOGIN       default "true" — fill login form and submit. Set "false" to inject session (faster)
 *   E2E_SLOW_MS        optional delay between route navigations (ms)
 *   E2E_INTER_USER_MS  pause between users (default 2500) to reduce auth rate limits
 *   E2E_IGNORE_CONSOLE set "1" to record console errors but not fail the visit on console alone
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const outputDir = path.join(root, "test-results", "role-crawl");
const slowMs = Number(process.env.E2E_SLOW_MS || "0") || 0;
const useUiLogin = process.env.E2E_UI_LOGIN !== "false";
const ignoreConsoleFailures = process.env.E2E_IGNORE_CONSOLE === "1";
const interUserDelayMs = Number(process.env.E2E_INTER_USER_MS || "2500") || 0;

/** @type {{ email: string, password: string, role: string, dashboard: string }[]} */
const users = [
  { email: "admin@suraksha.local", password: "SurakshaAdmin@2026", role: "org_admin", dashboard: "/dashboard" },
  { email: "compliance@suraksha.local", password: "SurakshaCompliance@2026", role: "compliance_admin", dashboard: "/dashboard/compliance" },
  { email: "security@suraksha.local", password: "SurakshaSecurity@2026", role: "security_team", dashboard: "/dashboard/security" },
  { email: "audit@suraksha.local", password: "SurakshaAudit@2026", role: "internal_auditor", dashboard: "/dashboard/audit" },
  { email: "executive@suraksha.local", password: "SurakshaExecutive@2026", role: "executive_viewer", dashboard: "/dashboard/executive" },
  { email: "owner@suraksha.local", password: "SurakshaOwner@2026", role: "department_owner", dashboard: "/dashboard/team" },
];

/**
 * personas: null = all roles; else must include role (same rules as sidebar filter).
 * @type {{ path: string, personas: string[] | null }[]}
 */
const NAV_ACCESS = [
  { path: "/dashboard", personas: null },
  { path: "/upload", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { path: "/documents", personas: null },
  { path: "/obligations", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "department_owner"] },
  { path: "/map-board", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner"] },
  { path: "/knowledge-graph", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor"] },
  { path: "/drift", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { path: "/readiness", personas: null },
  { path: "/evidence", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner", "internal_auditor", "external_auditor"] },
  { path: "/impact", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "executive_viewer"] },
  { path: "/security-findings", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "security_team", "it_owner"] },
  { path: "/reports", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor", "executive_viewer", "external_auditor"] },
  { path: "/audit", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "internal_auditor", "external_auditor"] },
  { path: "/agents", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "internal_auditor"] },
  { path: "/admin/users", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/departments", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/teams", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/access", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/settings", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin"] },
  { path: "/analytics", personas: ["platform_admin", "org_admin", "compliance_admin", "internal_auditor", "executive_viewer"] },
];

/** Extra dashboard URLs (shell allows all authenticated users) — smoke test for crashes. */
const DASHBOARD_SUBROUTES = [
  "/dashboard/executive",
  "/dashboard/compliance",
  "/dashboard/security",
  "/dashboard/audit",
  "/dashboard/team",
];

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx);
    if (!process.env[k]) process.env[k] = trimmed.slice(idx + 1);
  }
}

function roleAllowed(role, personas) {
  if (!personas || personas.length === 0) return true;
  return personas.includes(role);
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(baseURL);
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`App server is not reachable at ${baseURL}. Start it with npm run dev.`);
}

async function signInForToken(user) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`Supabase login failed for ${user.email}: ${error?.message || "missing session"}`);
  }
  return data.session.access_token;
}

async function loginSessionInject(page, user) {
  const token = await signInForToken(user);
  const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const projectRef = supabaseUrl.hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error(`Could not resolve auth user for ${user.email}: ${error?.message || "missing user"}`);
  }
  const sessionPayload = {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-refresh-token",
    user: data.user,
  };

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: storageKey, value: sessionPayload }
  );
  await page.goto(`${baseURL}${user.dashboard}`, { waitUntil: "domcontentloaded" });
  await waitForAppShell(page, 60_000);
}

/** App layout uses a fixed sidebar (`aside`); center brand can be `hidden lg:` and fail strict visibility checks. */
async function waitForAppShell(page, timeoutMs) {
  await page.locator("aside").first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function loginThroughUi(page, user) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /welcome back/i }).waitFor({ state: "visible", timeout: 20_000 });
      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(user.password);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith("/login"), {
          timeout: 60_000,
          waitUntil: "commit",
        }),
        page.getByRole("button", { name: /sign in to workspace/i }).click(),
      ]);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await waitForAppShell(page, 90_000);
      return;
    } catch (e) {
      lastErr = e;
      const url = page.url();
      const snippet = await page.locator("body").innerText().catch(() => "");
      console.warn(`loginThroughUi attempt ${attempt}/3 failed for ${user.email} url=${url} err=${e instanceof Error ? e.message : e}`);
      console.warn(`body (first 400 chars): ${snippet.slice(0, 400)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.warn(`UI login failed after 3 attempts for ${user.email}; falling back to session injection.`);
  await loginSessionInject(page, user);
}

function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
}

function attachCollectors(page, bucket) {
  const onConsole = (msg) => {
    if (msg.type() === "error") bucket.consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
  };
  const onPageError = (err) => bucket.pageErrors.push(err.message);
  const onRequestFailed = (req) => {
    const url = req.url();
    const errorText = req.failure()?.errorText || "";
    if (!url.includes("/_next/webpack-hmr") && !errorText.includes("ERR_ABORTED")) {
      bucket.failedRequests.push(`${req.method()} ${url} ${errorText}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
  };
}

async function visitRoute(page, user, routePath, allowed, report) {
  const bucket = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const detach = attachCollectors(page, bucket);

  const shotDir = path.join(outputDir, "screenshots", user.role);
  fs.mkdirSync(shotDir, { recursive: true });
  const shotPath = path.join(shotDir, `${slug(routePath)}.png`);

  let ok = true;
  let detail = "";

  try {
    await page.goto(`${baseURL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForSelector("body", { state: "visible", timeout: 15_000 });
    if (allowed) {
      await page.locator("aside").first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => undefined);
    }

    const bodyText = await page.locator("body").innerText({ timeout: 12_000 });
    const crash = /Unhandled Runtime Error|Application error|This page could not be found/i.test(bodyText);
    if (crash) {
      ok = false;
      detail = "Next.js error / 404 page detected";
    }

    const hasAccessDenied = /Access denied/i.test(bodyText) && /cannot access this page/i.test(bodyText);
    const asideVisible = await page.locator("aside").first().isVisible().catch(() => false);
    const sessionLoading = /Checking secure session/i.test(bodyText);

    if (allowed) {
      if (hasAccessDenied) {
        ok = false;
        detail = "Expected allowed route but saw Access denied";
      } else if (!asideVisible && !sessionLoading) {
        ok = false;
        detail = "Expected app shell (sidebar aside) not found";
      }
    } else {
      if (!hasAccessDenied) {
        ok = false;
        detail = "Expected Access denied for forbidden route";
      }
    }

    if (bucket.pageErrors.length) {
      ok = false;
      if (!detail) detail = "Uncaught page errors";
    }
    if (bucket.consoleErrors.length && !ignoreConsoleFailures) {
      ok = false;
      if (!detail) detail = "Browser console errors";
    }
    if (bucket.failedRequests.length) {
      ok = false;
      if (!detail) detail = "Failed network requests";
    }

    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? e.message : String(e);
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
    } catch {}
  } finally {
    detach();
  }

  const entry = {
    role: user.role,
    email: user.email,
    route: routePath,
    allowed,
    ok,
    detail,
    screenshot: path.relative(root, shotPath),
    consoleErrors: bucket.consoleErrors,
    pageErrors: bucket.pageErrors,
    failedRequests: bucket.failedRequests,
  };
  report.visits.push(entry);
  if (!ok) report.failures.push(entry);
  if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
}

async function crawlUser(browser, user, report) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    if (useUiLogin) await loginThroughUi(page, user);
    else await loginSessionInject(page, user);

    for (const { path: routePath, personas } of NAV_ACCESS) {
      const allowed = roleAllowed(user.role, personas);
      await visitRoute(page, user, routePath, allowed, report);
    }

    for (const routePath of DASHBOARD_SUBROUTES) {
      const bucket = { consoleErrors: [], pageErrors: [], failedRequests: [] };
      const detach = attachCollectors(page, bucket);
      const shotDir = path.join(outputDir, "screenshots", user.role, "dashboard-variants");
      fs.mkdirSync(shotDir, { recursive: true });
      const shotPath = path.join(shotDir, `${slug(routePath)}.png`);
      let ok = true;
      let detail = "";
      try {
        await page.goto(`${baseURL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
        const bodyText = await page.locator("body").innerText({ timeout: 12_000 });
        if (/Unhandled Runtime Error|Application error|This page could not be found/i.test(bodyText)) {
          ok = false;
          detail = "Next.js error / 404";
        }
        const asideOk = await page.locator("aside").first().isVisible().catch(() => false);
        if (!asideOk) {
          ok = false;
          detail = "Shell missing on dashboard sub-route (no aside)";
        }
        if (bucket.pageErrors.length) {
          ok = false;
          detail = "Page errors on dashboard sub-route";
        }
        if (bucket.consoleErrors.length && !ignoreConsoleFailures) {
          ok = false;
          detail = "Console errors on dashboard sub-route";
        }
        if (bucket.failedRequests.length) {
          ok = false;
          detail = "Failed requests on dashboard sub-route";
        }
        await page.screenshot({ path: shotPath, fullPage: true });
      } catch (e) {
        ok = false;
        detail = e instanceof Error ? e.message : String(e);
      } finally {
        detach();
      }
      const entry = {
        role: user.role,
        email: user.email,
        route: routePath,
        allowed: true,
        ok,
        detail,
        kind: "dashboard_subroute",
        screenshot: path.relative(root, shotPath),
        consoleErrors: bucket.consoleErrors,
        pageErrors: bucket.pageErrors,
        failedRequests: bucket.failedRequests,
      };
      report.visits.push(entry);
      if (!ok) report.failures.push(entry);
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
    }
  } finally {
    await context.close();
  }
}

function writeMarkdownSummary(report) {
  const lines = [
    "# Role browser crawl report",
    "",
    `- **Started:** ${report.startedAt}`,
    `- **Finished:** ${report.finishedAt}`,
    `- **Base URL:** ${report.baseURL}`,
    `- **UI login:** ${report.useUiLogin ? "yes (real form)" : "no (session inject)"}`,
    `- **Ignore console failures:** ${report.ignoreConsoleFailures ? "yes" : "no"}`,
    "",
    `## Summary`,
    "",
    `- Total visits: ${report.visits.length}`,
    `- **Failures: ${report.failures.length}**`,
    "",
  ];
  if (report.failures.length === 0) {
    lines.push("All role/route checks passed.", "");
    return lines.join("\n");
  }
  lines.push("## Failures", "");
  for (const f of report.failures) {
    lines.push(`### ${f.role} — \`${f.route}\``, "");
    lines.push(`- **OK:** ${f.ok}`);
    lines.push(`- **Allowed (RBAC):** ${f.allowed}`);
    lines.push(`- **Detail:** ${f.detail || "—"}`);
    lines.push(`- **Screenshot:** \`${f.screenshot}\``);
    if (f.consoleErrors?.length) lines.push(`- **Console:** ${f.consoleErrors.map((x) => `\`${x}\``).join("; ")}`);
    if (f.pageErrors?.length) lines.push(`- **Page errors:** ${f.pageErrors.map((x) => `\`${x}\``).join("; ")}`);
    if (f.failedRequests?.length) lines.push(`- **Failed requests:** ${f.failedRequests.slice(0, 5).join("; ")}${f.failedRequests.length > 5 ? " …" : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  loadEnv();
  fs.mkdirSync(path.join(outputDir, "screenshots"), { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    baseURL,
    useUiLogin,
    ignoreConsoleFailures,
    visits: [],
    failures: [],
  };

  await waitForServer();

  const browser = await chromium.launch({ headless: process.env.E2E_HEADLESS !== "false" });
  try {
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (i > 0 && interUserDelayMs) await new Promise((r) => setTimeout(r, interUserDelayMs));
      console.log(`\n--- Crawl as ${user.role} (${user.email}) ---`);
      await crawlUser(browser, user, report);
    }
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const jsonPath = path.join(outputDir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const mdPath = path.join(outputDir, "SUMMARY.md");
  fs.writeFileSync(mdPath, writeMarkdownSummary(report));

  console.log("\n" + JSON.stringify({
    ok: report.failures.length === 0,
    json: path.relative(root, jsonPath),
    markdown: path.relative(root, mdPath),
    visits: report.visits.length,
    failures: report.failures.length,
  }, null, 2));

  if (report.failures.length) process.exit(1);
}

main().catch((err) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "failure.json"),
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2)
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
