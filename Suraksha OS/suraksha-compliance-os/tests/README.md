# Playwright E2E tests

End-to-end UI and API-smoke tests for **Suraksha Compliance OS**.

## Prerequisites

1. **Environment:** Copy `.env.example` → `.env.local` with valid Supabase `NEXT_PUBLIC_*` and `SUPABASE_SERVICE_ROLE_KEY` (same as normal dev).
2. **Database:** Apply migrations and seed enterprise demo users (see repo `README` / `scripts/seed-enterprise.cjs`).
3. **App:** `npm run dev` (default `http://localhost:3000`).

## Commands

```bash
npm run test:playwright          # headless CI-style
npm run test:playwright:ui       # interactive UI mode
npm run test:playwright:headed   # headed browser
```

Optional env (see `.env.example`):

- `E2E_BASE_URL` — default `http://localhost:3000`
- `E2E_FOUNDER_EMAIL` / `E2E_FOUNDER_PASSWORD` — override seed credentials
- Same pattern for `E2E_MANAGER_*`, `E2E_COMPLIANCE_*`

## Layout

| Directory | Scope |
|-----------|--------|
| `auth/` | Login, logout, unauthenticated redirects |
| `founder/` | Founder console, org drill-down, founder API rules |
| `manager/` | Bank admin (users, departments, teams) |
| `compliance/` | Tenant compliance modules |
| `security/` | RBAC smoke, API 401/403, tenant API smoke |
| `agents/` | Agents console + audit page smoke |
| `e2e/` | Cross-role journeys |

**Note:** Deep RLS proofs run in `node scripts/enterprise-audit.cjs` (Bearer probes). Playwright complements that with real browser auth (Supabase session in `localStorage`).

## Agent service

Tests **do not** require the Python agent-service. The Agents page asserts controls are present; health may show “Unreachable” if `AGENT_SERVICE_URL` is unset.
