import { test, expect } from "@playwright/test";
import { skipIfNoSupabaseConfigured } from "../helpers/env";

/** RLS is enforced in Postgres; browser E2E only verifies unauthenticated API rejection. */
test.describe("RLS-related API surface (smoke)", () => {
  test.beforeEach(({ }, testInfo) => {
    skipIfNoSupabaseConfigured(testInfo);
  });

  test("unauthenticated /api/me returns 401", async ({ request }) => {
    const res = await request.get("/api/me");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated /api/obligations returns 401", async ({ request }) => {
    const res = await request.get("/api/obligations");
    expect(res.status()).toBe(401);
  });
});
