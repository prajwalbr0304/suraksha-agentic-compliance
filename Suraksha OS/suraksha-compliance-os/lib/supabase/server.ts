/**
 * Supabase Server Client
 *
 * Uses the service_role key — bypasses RLS for admin operations.
 * ONLY import this in:
 *   - Next.js Server Components (no "use client" at top)
 *   - Next.js API Route Handlers (app/api/**)
 *   - Server Actions
 *
 * NEVER import this in client components — the service role key would be
 * bundled into the browser JavaScript and expose full database access.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Creates a fresh server-side Supabase client per request.
 * Do NOT cache this — each request should have its own client instance.
 */
export function getSupabaseServerClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "These must be set in .env.local and are server-only."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
