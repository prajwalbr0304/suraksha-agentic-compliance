import { test, expect } from "@playwright/test";
import { signIn, apiGetJson, expectAccessDeniedOrLogin } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Manager permissions", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("manager can list org users via API", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    const { status, body } = await apiGetJson(page, "/api/admin/users");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBeTruthy();
  });

  test("manager cannot call founder banks API", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    const { status } = await apiGetJson(page, "/api/founder/banks");
    expect(status).toBe(403);
  });

  test("compliance user blocked from admin users", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    await expectAccessDeniedOrLogin(page, "/admin/users");
  });
});
