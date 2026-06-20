import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Manager — users", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    await page.goto("/admin/users");
  });

  test("users table visible", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("table").first()).toBeVisible();
  });
});
