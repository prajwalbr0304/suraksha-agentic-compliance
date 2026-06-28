import type { SupabaseClient } from "@supabase/supabase-js";

/** True if this auth user id is registered in `public.founders`. */
export async function isFounderAccountId(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("founders").select("id").eq("id", userId).maybeSingle();
  return !!data;
}
