import { test, expect } from "@playwright/test";
import { signIn, signOutViaUi } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Logout", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("sign out returns to login", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    await signOutViaUi(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
