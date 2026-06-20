"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { useFounderRouteOrgId } from "@/hooks/use-founder-route-org-id";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Obligation } from "@/types";

interface UseObligationsResult {
  obligations: Obligation[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useObligations(): UseObligationsResult {
  const founderOrgId = useFounderRouteOrgId();
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchObligations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    let q = supabase
      .from("obligations")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(100);
    if (founderOrgId) q = q.eq("organization_id", founderOrgId);
    const { data, error: fetchError, count } = await q;

    if (fetchError) {
      setError(fetchError.message);
      setIsLoading(false);
      return;
    }

    setTotalCount(count ?? 0);
    setObligations(
      (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        reference: (row.reference as string) || undefined,
        title: row.title as string,
        description: (row.description as string) || "",
        source: row.regulation as string,
        regulator: row.jurisdiction as string,
        department: row.department as string,
        status: mapObligationStatus(row.status as string),
        confidence: row.confidence_score as number,
        dueDate: row.due_date as string,
        priority: mapPriority(row.priority as string),
        citations: (row.tags as string[]) ?? [],
        sourceQuote: (row.source_quote as string) ?? null,
        aiExplanation: (row.ai_explanation as string) ?? null,
        extractionReason: (row.extraction_reason as string) ?? null,
      }))
    );
    setIsLoading(false);
  }, [founderOrgId]);

  useEffect(() => {
    fetchObligations();
  }, [fetchObligations]);

  useEffect(() => {
    const channel = supabase
      .channel("obligations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "obligations" }, () => {
        fetchObligations();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchObligations]);

  return { obligations, totalCount, isLoading, error, refetch: fetchObligations };
}

function mapObligationStatus(status: string): Obligation["status"] {
  switch (status) {
    case "compliant": return "completed";
    case "in_progress": return "active";
    case "at_risk": return "pending";
    case "overdue": return "overdue";
    case "pending_review": return "pending";
    default: return "active";
  }
}

function mapPriority(priority: string): Obligation["priority"] {
  if (priority === "critical" || priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}
