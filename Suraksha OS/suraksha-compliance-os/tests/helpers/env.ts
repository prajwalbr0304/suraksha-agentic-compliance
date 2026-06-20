/**
 * E2E credentials — defaults match `scripts/seed-enterprise.cjs` / enterprise audit.
 * Override with env vars for your tenant.
 */
export const e2eBaseUrl = () => process.env.E2E_BASE_URL || "http://localhost:3000";

export const e2eCredentials = {
  founder: {
    email: process.env.E2E_FOUNDER_EMAIL || "founder@suraksha.local",
    password: process.env.E2E_FOUNDER_PASSWORD || "SurakshaFounder@2026",
  },
  manager: {
    email: process.env.E2E_MANAGER_EMAIL || "manager@hdfc-bank.suraksha.local",
    password: process.env.E2E_MANAGER_PASSWORD || "SurakshaManager@2026",
  },
  compliance: {
    email: process.env.E2E_COMPLIANCE_EMAIL || "compliance@suraksha.local",
    password: process.env.E2E_COMPLIANCE_PASSWORD || "SurakshaCompliance@2026",
  },
  iciciManager: {
    email: process.env.E2E_ICICI_MANAGER_EMAIL || "manager@icici-bank.suraksha.local",
    password: process.env.E2E_ICICI_MANAGER_PASSWORD || "SurakshaManager@2026",
  },
};

export function skipIfNoSupabaseConfigured(test: { skip: (condition?: boolean, description?: string) => void }) {
  const ok = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  test.skip(!ok, "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (e.g. in .env.local)");
}
