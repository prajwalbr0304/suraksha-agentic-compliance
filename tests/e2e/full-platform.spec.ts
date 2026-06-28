import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

/**
 * Cross-cutting smoke: founder platform + manager tenant + compliance modules.
 * Run against `npm run dev` with enterprise seed (`node scripts/seed-enterprise.cjs`).
 */
test.describe("Full platform smoke", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("founder → organizations → HDFC overview", async ({ page }) => {
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    await page.goto("/founder/organizations");
    await page.getByRole("link", { name: /HDFC Bank/i }).first().click();
    await expect(page.getByRole("heading", { name: "HDFC Bank" })).toBeVisible({ timeout: 20_000 });
  });

  test("manager hits dashboard then documents", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    await expect(page).toHaveURL(/\/dashboard\/.+\/compliance/, { timeout: 20_000 });
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Document Repository" })).toBeVisible({ timeout: 25_000 });
  });

  test("compliance dashboard redirect then MAP board", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await expect(page).toHaveURL(/\/dashboard\/.+\/compliance/, { timeout: 20_000 });
    await page.goto("/map-board");
    await expect(page.getByRole("heading", { name: "Compliance Action Board" }).first()).toBeVisible({ timeout: 25_000 });
  });
});
