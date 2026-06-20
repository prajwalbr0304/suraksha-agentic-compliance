import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Agents UI — monitoring", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/agents");
  });

  test("Monitor control visible", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "AI Agents" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: /Monitor/i })).toBeVisible();
  });
});
