import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Founder managers", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    await page.goto("/founder/managers");
  });

  test("page renders", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Managers/i })).toBeVisible({ timeout: 20_000 });
  });
});
