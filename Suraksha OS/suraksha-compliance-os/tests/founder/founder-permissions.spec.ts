import { test, expect } from "@playwright/test";
import { signIn, apiGetJson, expectAccessDeniedOrLogin } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Founder API & tenant drill-down", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("founder can call founder overview", async ({ page }) => {
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    const { status, body } = await apiGetJson(page, "/api/founder/overview");
    expect(status).toBe(200);
    expect(body).toMatchObject({ total_banks: expect.any(Number) });
  });

  test("founder blocked from tenant obligations without org header", async ({ page }) => {
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    const { status } = await apiGetJson(page, "/api/obligations");
    expect([400, 403]).toContain(status);
  });

  test("founder cannot use bank admin users UI (role not in nav personas)", async ({ page }) => {
    await signIn(page, e2eCredentials.founder.email, e2eCredentials.founder.password);
    await page.goto("/admin/users");
    await expect(page.getByText(/No active organization/i)).toBeVisible({ timeout: 15_000 });
  });
});
