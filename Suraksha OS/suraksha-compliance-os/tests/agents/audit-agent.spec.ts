import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Agents UI — audit trail linkage", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/audit");
  });

  test("audit trail page loads for auditor-capable role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible({ timeout: 25_000 });
  });
});
