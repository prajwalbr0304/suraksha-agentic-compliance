"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { authFetch, type AuthFetchOptions } from "@/lib/auth/client";

export type TenantApiFn = (input: RequestInfo | URL, init?: AuthFetchOptions) => Promise<Response>;

const TenantApiContext = createContext<TenantApiFn>(authFetch);

export function TenantApiProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const bound = useMemo<TenantApiFn>(
    () => (input, init) => authFetch(input, { ...init, surakshaOrgId: orgId }),
    [orgId]
  );
  return <TenantApiContext.Provider value={bound}>{children}</TenantApiContext.Provider>;
}

export function useTenantApi(): TenantApiFn {
  return useContext(TenantApiContext);
}
