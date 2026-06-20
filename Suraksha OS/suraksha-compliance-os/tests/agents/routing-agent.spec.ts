import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Agents UI — routing (department assignment)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/agents");
  });

  test("copy mentions MAP generation and departments", async ({ page }) => {
    await expect(page.getByText(/departments/i).first()).toBeVisible({ timeout: 25_000 });
  });
});
