import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Agents UI — evidence validation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/agents");
  });

  test("Validate compliance evidence button visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Validate compliance evidence/i })).toBeVisible({ timeout: 25_000 });
  });
});
