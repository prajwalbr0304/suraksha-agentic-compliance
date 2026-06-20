import { test, expect } from "@playwright/test";
import { signIn, apiGetJson } from "../helpers/auth";
import { e2eCredentials, skipIfNoSupabaseConfigured } from "../helpers/env";

test.describe("Privilege escalation guards", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("compliance admin cannot grant founder-only platform APIs", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    const overview = await apiGetJson(page, "/api/founder/overview");
    expect(overview.status).toBe(403);
  });

  test("compliance admin cannot list admin users API", async ({ page }) => {
    await signIn(page, e2eCredentials.compliance.email, e2eCredentials.compliance.password);
    const { status } = await apiGetJson(page, "/api/admin/users");
    expect(status).toBe(403);
  });
});
