import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Evidence", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/evidence");
  });

  test("evidence page loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Evidence Intelligence" })).toBeVisible({ timeout: 25_000 });
  });
});
