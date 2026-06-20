import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Login", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("invalid credentials show error", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("not-a-real-user@example.com");
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: /Sign in to workspace/i }).click();
    await expect(page.locator("[class*='border-red-500']")).toBeVisible({ timeout: 15_000 });
  });

  test("founder reaches founder console", async ({ page }) => {
    const { email, password } = e2eCredentials.founder;
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/founder/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Founder Dashboard" })).toBeVisible({ timeout: 20_000 });
  });

  test("bank manager reaches compliance dashboard", async ({ page }) => {
    const { email, password } = e2eCredentials.manager;
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });
});
