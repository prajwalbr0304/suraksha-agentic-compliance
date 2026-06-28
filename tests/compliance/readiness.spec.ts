import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Readiness", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/readiness");
  });

  test("readiness scoring loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Compliance Readiness Scoring" })).toBeVisible({ timeout: 25_000 });
  });
});
