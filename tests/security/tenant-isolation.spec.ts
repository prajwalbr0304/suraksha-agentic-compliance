import { test, expect } from "@playwright/test";
import { signIn, apiGetJson } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Tenant isolation (API smoke)", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("bank manager tenant APIs succeed for home org", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    const users = await apiGetJson(page, "/api/admin/users");
    const analytics = await apiGetJson(page, "/api/analytics");
    expect(users.status).toBe(200);
    expect(analytics.status).toBe(200);
  });

  test("bank manager cannot list founder banks", async ({ page }) => {
    await signIn(page, e2eCredentials.manager.email, e2eCredentials.manager.password);
    const { status } = await apiGetJson(page, "/api/founder/banks");
    expect(status).toBe(403);
  });
});
