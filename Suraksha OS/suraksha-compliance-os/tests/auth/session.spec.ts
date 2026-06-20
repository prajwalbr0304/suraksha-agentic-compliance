import { test, expect } from "@playwright/test";
import { skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Session / route protection", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("unauthenticated user is redirected from protected route", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });
});
