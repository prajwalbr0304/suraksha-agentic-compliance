"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { AuditEntry } from "@/types";

interface UseAuditTrailResult {
  entries: AuditEntry[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  loadMore: () => void;
}

const PAGE_SIZE = 20;

interface UseAuditTrailOptions {
  /** When set (e.g. founder bank drill-down), restrict rows to this organization. */
  organizationId?: string | null;
}

export function useAuditTrail(options?: UseAuditTrailOptions): UseAuditTrailResult {
  const orgFilter = options?.organizationId ?? null;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchEntries = useCallback(async (pageNum: number, append = false) => {
    if (!append) setIsLoading(true);
    setError(null);

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("audit_trail")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (orgFilter) {
      query = query.eq("organization_id", orgFilter) as typeof query;
    }

    const { data, error: fetchError, count } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setIsLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    const mapped = (data ?? []).map((row: Record<string, unknown>): AuditEntry => ({
      id: row.id as string,
      actor: row.actor as string,
      action: row.details as string,
      target: row.target as string,
      timestamp: formatTimestamp(row.created_at as string),
      type: mapActionToType(row.action as string),
      metadata: row.metadata as Record<string, string> | undefined,
    }));

    if (append) {
      setEntries((prev) => [...prev, ...mapped]);
    } else {
      setEntries(mapped);
    }
    setIsLoading(false);
  }, [orgFilter]);

  const loadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchEntries(nextPage, true);
  }, [page, fetchEntries]);

  useEffect(() => {
    fetchEntries(0);
  }, [fetchEntries]);

  // Realtime: prepend new entries
  useEffect(() => {
    const channel = supabase
      .channel("audit-trail-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_trail" }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (orgFilter && row.organization_id !== orgFilter) return;
        const newEntry: AuditEntry = {
          id: row.id as string,
          actor: row.actor as string,
          action: row.details as string,
          target: row.target as string,
          timestamp: formatTimestamp(row.created_at as string),
          type: mapActionToType(row.action as string),
          metadata: row.metadata as Record<string, string> | undefined,
        };
        setEntries((prev) => [newEntry, ...prev]);
        setTotalCount((prev) => prev + 1);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [orgFilter, fetchEntries]);

  return { entries, totalCount, isLoading, error, refetch: () => fetchEntries(0), loadMore };
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

function mapActionToType(action: string): AuditEntry["type"] {
  if (action.includes("upload")) return "upload";
  if (action.includes("process") || action.includes("extract")) return "extraction";
  if (action.includes("review") || action.includes("closed")) return "approval";
  if (action.includes("risk") || action.includes("alert") || action.includes("escalat")) return "escalation";
  if (action.includes("update") || action.includes("created")) return "modification";
  return "review";
}
