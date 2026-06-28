/**
 * Supabase Browser Client
 *
 * Uses the anon/public key. Safe to import in "use client" components.
 * Row-Level Security (RLS) policies apply — users only see their own data.
 *
 * Note: We don't pass the Database generic to createClient here because
 * TypeScript's structural check between `{ [_ in never]: never }` (empty
 * mapped type) and `Record<string, GenericView>` (index-signature type) is
 * unsatisfiable at the generic constraint level in supabase-js v2.105+.
 * Type safety is enforced at the service layer via explicit return annotations.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (typeof window !== "undefined" && (!supabaseUrl || !supabaseAnonKey)) {
  console.error(
    "[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Check your .env.local file."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});


