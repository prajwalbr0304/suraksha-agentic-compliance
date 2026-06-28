import { test, expect } from "@playwright/test";
import { signIn, getAccessTokenFromPage } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

/**
 * Full ABAC matrix requires seeded `department_owner` / scoped users.
 * Smoke: org-wide compliance role reaches tenant obligations API.
 */
test.describe("ABAC (smoke)", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("compliance role loads obligations API for default org", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    const token = await getAccessTokenFromPage(page);
    expect(token).toBeTruthy();
    const res = await page.request.get("/api/obligations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });
});
