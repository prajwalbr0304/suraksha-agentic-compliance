import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Agents UI — drift / impact / audit (coordinator)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/agents");
  });

  test("agent runs panel renders", async ({ page }) => {
    await expect(page.getByText("Agent Runs").first()).toBeVisible({ timeout: 25_000 });
  });
});
