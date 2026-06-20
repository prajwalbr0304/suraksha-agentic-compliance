import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Manager — departments", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    await page.goto("/admin/departments");
  });

  test("page renders", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible({ timeout: 20_000 });
  });
});
