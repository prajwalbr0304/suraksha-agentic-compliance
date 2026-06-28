import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Compliance Action Board", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/map-board");
  });

  test("board loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Compliance Action Board" }).first()).toBeVisible({ timeout: 25_000 });
  });
});
