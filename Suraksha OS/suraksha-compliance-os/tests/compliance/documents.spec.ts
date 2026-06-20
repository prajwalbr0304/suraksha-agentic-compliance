import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Documents", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/documents");
  });

  test("repository loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Document Repository" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("link", { name: /Upload Document/i })).toBeVisible();
  });
});
