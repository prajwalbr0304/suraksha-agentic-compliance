import { test, expect } from "@playwright/test";
import { signIn, expectAccessDeniedOrLogin } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("RBAC (navigation)", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("compliance admin can open obligations", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await page.goto("/obligations");
    await expect(page.getByRole("heading", { name: "Obligations Repository" })).toBeVisible({ timeout: 25_000 });
  });

  test("compliance admin cannot open bank user management", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await expectAccessDeniedOrLogin(page, "/admin/users");
  });
});
