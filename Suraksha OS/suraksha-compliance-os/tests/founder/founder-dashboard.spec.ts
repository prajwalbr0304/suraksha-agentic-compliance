import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Founder dashboard", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
  });

  test("KPI strip and per-bank table render", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Founder Dashboard" })).toBeVisible();
    await expect(page.getByText("Total banks", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Per-bank compliance breakdown")).toBeVisible();
  });

  test("quick link to Organizations", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Founder Dashboard" })).toBeVisible();
    await page.getByRole("link", { name: /Organizations/i }).first().click();
    await expect(page).toHaveURL(/\/founder\/organizations/);
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
  });
});
