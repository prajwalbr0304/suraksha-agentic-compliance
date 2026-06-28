"use client";

import { supabase } from "@/lib/supabase/client";

export async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error(error?.message ?? "Authentication required");
  }
  return data.session.access_token;
}

async function getRefreshedToken(): Promise<string> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    throw new Error("Session expired — please log in again");
  }
  return data.session.access_token;
}

export type AuthFetchOptions = RequestInit & {
  /** When set (e.g. founder drilling into a bank), sent as `x-suraksha-org-id` for API routes. */
  surakshaOrgId?: string | null;
};

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
  const { surakshaOrgId, ...rest } = init;
  const token = await getAccessToken();
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (surakshaOrgId) {
    headers.set("x-suraksha-org-id", surakshaOrgId);
  }
  const res = await fetch(input, { ...rest, headers });

  if (res.status === 401) {
    try {
      const refreshed = await getRefreshedToken();
      headers.set("Authorization", `Bearer ${refreshed}`);
      return fetch(input, { ...rest, headers });
    } catch {
      window.location.href = "/login";
      return res;
    }
  }

  return res;
}
