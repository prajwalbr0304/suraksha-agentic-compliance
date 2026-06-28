import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Drift analyzer", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/drift");
  });

  test("drift page loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Regulatory Change Analysis" })).toBeVisible({ timeout: 25_000 });
  });
});
