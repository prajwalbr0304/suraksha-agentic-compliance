"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestPrincipal } from "@/lib/auth/permissions";
import { authFetch } from "@/lib/auth/client";

interface PrincipalState {
  principal: RequestPrincipal | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePrincipal(): PrincipalState {
  const [principal, setPrincipal] = useState<RequestPrincipal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/me");
      if (!res.ok) throw new Error(`Failed to load principal (${res.status})`);
      setPrincipal(await res.json());
    } catch (err) {
      setPrincipal(null);
      setError(err instanceof Error ? err.message : "Failed to load principal");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { principal, isLoading, error, refetch };
}
