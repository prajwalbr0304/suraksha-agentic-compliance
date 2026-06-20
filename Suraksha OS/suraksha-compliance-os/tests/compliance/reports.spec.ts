import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Reports", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/reports");
  });

  test("reports page loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Compliance Reports" })).toBeVisible({ timeout: 25_000 });
  });
});
