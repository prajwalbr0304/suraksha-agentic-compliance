"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Generic Supabase query hook with realtime
// ---------------------------------------------------------------------------

interface UseSupabaseQueryOptions<T> {
  /** Supabase table name */
  table: string;
  /** Column to order by */
  orderBy?: string;
  /** Order ascending? */
  ascending?: boolean;
  /** Max rows */
  limit?: number;
  /** Filters as key:value pairs */
  filters?: Record<string, string | number | boolean>;
  /** Enable realtime subscription */
  realtime?: boolean;
  /** Transform raw rows */
  transform?: (rows: Record<string, unknown>[]) => T[];
}

interface UseSupabaseQueryResult<T> {
  data: T[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSupabaseQuery<T = Record<string, unknown>>(
  options: UseSupabaseQueryOptions<T>
): UseSupabaseQueryResult<T> {
  const { table, orderBy, ascending = false, limit = 100, filters, realtime = true, transform } = options;
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    let query = supabase.from(table).select("*");

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value) as typeof query;
      }
    }

    if (orderBy) {
      query = query.order(orderBy, { ascending }) as typeof query;
    }

    query = query.limit(limit) as typeof query;

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setIsLoading(false);
      return;
    }

    const rawRows = (rows ?? []) as Record<string, unknown>[];
    setData(transform ? transform(rawRows) : (rawRows as unknown as T[]));
    setIsLoading(false);
  }, [table, orderBy, ascending, limit, filters, transform]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Realtime subscription
  useEffect(() => {
    if (!realtime) return;

    const channel = supabase
      .channel(`${table}-realtime-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        // Re-fetch on any change
        fetchData();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [table, realtime, fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// ---------------------------------------------------------------------------
// RPC call hook (for dashboard KPIs)
// ---------------------------------------------------------------------------

interface UseSupabaseRpcResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSupabaseRpc<T = unknown>(
  fnName: string,
  args?: Record<string, unknown>
): UseSupabaseRpcResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc(fnName, args ?? {});

    if (rpcError) {
      setError(rpcError.message);
      setIsLoading(false);
      return;
    }

    setData(result as T);
    setIsLoading(false);
  }, [fnName, args]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// ---------------------------------------------------------------------------
// Optimistic update helper
// ---------------------------------------------------------------------------

export function useOptimisticUpdate<T extends { id: string }>(
  table: string,
  data: T[],
  setData: React.Dispatch<React.SetStateAction<T[]>>
) {
  const update = useCallback(
    async (id: string, updates: Partial<T>): Promise<{ error: string | null }> => {
      // Optimistic: update locally immediately
      const original = data.find((item) => item.id === id);
      if (!original) return { error: "Item not found" };

      setData((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));

      // Persist to Supabase
      const { error: dbError } = await supabase
        .from(table)
        .update(updates as Record<string, unknown>)
        .eq("id", id);

      if (dbError) {
        // Rollback on error
        setData((prev) => prev.map((item) => (item.id === id ? original : item)));
        return { error: dbError.message };
      }

      return { error: null };
    },
    [table, data, setData]
  );

  return { update };
}
