import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Sign in to workspace/i }).click();
  await page.waitForURL(/\/(founder|dashboard)/, { timeout: 45_000 });
}

export async function signOutViaUi(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

/** Supabase JS stores the session under a `sb-*-auth-token` localStorage key. */
export async function getAccessTokenFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.endsWith("-auth-token")) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed?.access_token) return parsed.access_token;
      } catch {
        /* ignore */
      }
    }
    return null;
  });
}

export async function apiGetJson(
  page: Page,
  pathname: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const token = await getAccessTokenFromPage(page);
  const h: Record<string, string> = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await page.request.get(pathname, { headers: h });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status(), body };
}

export async function expectAccessDeniedOrLogin(page: Page, path: string) {
  await page.goto(path);
  // Wait for loading screen to resolve
  try {
    await expect(page.getByText("Checking secure session...")).not.toBeVisible({ timeout: 5000 });
  } catch {}

  const denied = page.getByRole("heading", { name: /access denied/i });
  if (await denied.isVisible().catch(() => false)) {
    await expect(denied).toBeVisible();
    return;
  }
  
  // Wait for URL redirect to complete if not already redirected
  try {
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  } catch {}
  expect(page.url()).toMatch(/\/login/);
}
