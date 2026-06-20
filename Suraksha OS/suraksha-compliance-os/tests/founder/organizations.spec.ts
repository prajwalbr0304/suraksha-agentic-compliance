import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Founder organizations", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    await page.goto("/founder/organizations");
  });

  test("banks table loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bank" })).toBeVisible({ timeout: 20_000 });
  });

  test("open HDFC tenant workspace", async ({ page }) => {
    const link = page.getByRole("link", { name: /HDFC Bank/i }).first();
    await link.click();
    await expect(page).toHaveURL(/\/founder\/organizations\/[a-f0-9-]{36}/i);
    await expect(page.getByRole("heading", { name: "HDFC Bank" })).toBeVisible({ timeout: 15_000 });
  });
});
