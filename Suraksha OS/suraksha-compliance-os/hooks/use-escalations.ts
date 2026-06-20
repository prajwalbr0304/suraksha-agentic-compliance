"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

export interface Escalation {
  id: string;
  obligation_id: string | null;
  map_card_id: string | null;
  escalated_to: string;
  reason: string | null;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "acknowledged" | "resolved";
  resolved_at: string | null;
  created_at: string;
  obligations?: { title: string; department: string } | null;
  map_cards?: { title: string } | null;
}

export function useEscalations(limit = 10) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("escalations")
        .select("*, obligations(title, department), map_cards(title)")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (err) throw err;
      setEscalations((data ?? []) as Escalation[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load escalations");
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetch();
    const channel = supabase
      .channel("escalations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "escalations" }, () => fetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch]);

  return { escalations, isLoading, error, refetch: fetch };
}
