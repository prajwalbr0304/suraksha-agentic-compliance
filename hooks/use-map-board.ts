"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAccessToken } from "@/lib/auth/client";
import { useFounderRouteOrgId } from "@/hooks/use-founder-route-org-id";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MAPCard, MAPColumn, EvidenceItem } from "@/types";
import { pickAssignmentRationale } from "@/lib/ai-explainability";
import {
  MAP_COLUMN_LABELS,
  MAP_UI_COLUMN_ORDER,
  mapColumnIdToDbStatus,
  mapDbStatusToColumnId,
} from "@/lib/map-lifecycle";

interface UseMapBoardResult {
  columns: MAPColumn[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  updateCardStatus: (cardId: string, newStatus: MAPCard["status"]) => Promise<{ error: string | null }>;
  /** Partial update via API (audit + map_activity) */
  patchCard: (
    cardId: string,
    fields: { status?: MAPCard["status"]; assignedTo?: string | null; teamId?: string | null },
  ) => Promise<{ error: string | null }>;
}

function uiStatusToDB(status: MAPCard["status"]): string {
  return mapColumnIdToDbStatus(status);
}

async function putMapCardApi(
  cardId: string,
  body: Record<string, unknown>,
  founderOrgId: string | null,
): Promise<{ error: string | null }> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (founderOrgId) headers["x-suraksha-org-id"] = founderOrgId;
    const res = await fetch(`/api/map-cards/${cardId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: j.error ?? `Update failed (${res.status})` };
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

export function useMapBoard(): UseMapBoardResult {
  const founderOrgId = useFounderRouteOrgId();
  const [columns, setColumns] = useState<MAPColumn[]>(
    MAP_UI_COLUMN_ORDER.map((id) => ({ id, title: MAP_COLUMN_LABELS[id], cards: [] })),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchMapBoard = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    let cardsQuery = supabase
      .from("map_cards")
      .select(
        `
        *,
        obligations (
          department,
          title,
          source_quote,
          ai_explanation,
          extraction_reason
        )
      `,
      )
      .neq("status", "archived")
      .order("created_at", { ascending: false });
    if (founderOrgId) cardsQuery = cardsQuery.eq("organization_id", founderOrgId);
    const { data: cards, error: cardsError } = await cardsQuery;

    if (cardsError) {
      setError(cardsError.message);
      setIsLoading(false);
      return;
    }

    const obligationIds = (cards ?? [])
      .map((c: Record<string, unknown>) => c.obligation_id as string)
      .filter(Boolean);

    const evidenceByObligation: Record<string, EvidenceItem[]> = {};

    if (obligationIds.length > 0) {
      const { data: evidenceData } = await supabase.from("evidence").select("*").in("obligation_id", obligationIds);

      if (evidenceData) {
        for (const ev of evidenceData as Record<string, unknown>[]) {
          const oblId = ev.obligation_id as string;
          if (!evidenceByObligation[oblId]) evidenceByObligation[oblId] = [];
          evidenceByObligation[oblId].push({
            id: ev.id as string,
            title: ev.title as string,
            completed: (ev.collected_at as string | null) !== null,
          });
        }
      }
    }

    const newColumns: MAPColumn[] = MAP_UI_COLUMN_ORDER.map((status) => ({
      id: status,
      title: MAP_COLUMN_LABELS[status],
      cards: (cards ?? [])
        .filter((c: Record<string, unknown>) => mapDbStatusToColumnId(String(c.status)) === status)
        .map((c: Record<string, unknown>): MAPCard => {
          const rawObl = c.obligations as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
          const obl = Array.isArray(rawObl) ? rawObl[0] : rawObl;
          const oblDept = obl && typeof obl.department === "string" ? obl.department.trim() : "";
          const cardDept = typeof c.department === "string" ? c.department.trim() : "";
          const ownerDepartment = cardDept || oblDept || null;
          const obligationTitle = obl && typeof obl.title === "string" ? (obl.title as string) : null;
          const assignmentRationale =
            obl && typeof obl === "object"
              ? pickAssignmentRationale({
                  extraction_reason: obl.extraction_reason as string | null | undefined,
                  ai_explanation: obl.ai_explanation as string | null | undefined,
                  source_quote: obl.source_quote as string | null | undefined,
                })
              : null;

          return {
            id: c.id as string,
            title: c.title as string,
            obligation: c.obligation_id as string,
            obligationTitle,
            ownerDepartment,
            assignmentRationale,
            owner: c.owner as string,
            dueDate: c.due_date as string,
            status: mapDbStatusToColumnId(String(c.status)) as MAPCard["status"],
            priority: mapPriority(c.priority as string),
            evidence: evidenceByObligation[c.obligation_id as string] ?? [],
            comments: c.comments_count as number,
            escalated: c.escalated as boolean,
            generatedBy: (c.generated_by as string) ?? "manual",
            assignedTo: (c.assigned_to as string | null) ?? null,
            teamId: (c.team_id as string | null) ?? null,
          };
        }),
    }));

    setColumns(newColumns);
    setIsLoading(false);
  }, [founderOrgId]);

  const updateCardStatus = useCallback(
    async (cardId: string, newStatus: MAPCard["status"]): Promise<{ error: string | null }> => {
      let originalCard: MAPCard | undefined;
      let originalColId: string | undefined;

      for (const col of columns) {
        const found = col.cards.find((c) => c.id === cardId);
        if (found) {
          originalCard = found;
          originalColId = col.id;
          break;
        }
      }

      if (!originalCard || !originalColId) return { error: "Card not found" };

      setColumns((prev) =>
        prev.map((col) => {
          if (col.id === originalColId) {
            return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
          }
          if (col.id === newStatus) {
            return { ...col, cards: [...col.cards, { ...originalCard!, status: newStatus }] };
          }
          return col;
        }),
      );

      const { error: apiError } = await putMapCardApi(cardId, { status: uiStatusToDB(newStatus) }, founderOrgId ?? null);

      if (apiError) {
        await fetchMapBoard();
        return { error: apiError };
      }

      await fetchMapBoard();
      return { error: null };
    },
    [columns, founderOrgId, fetchMapBoard],
  );

  const patchCard = useCallback(
    async (
      cardId: string,
      fields: { status?: MAPCard["status"]; assignedTo?: string | null; teamId?: string | null },
    ): Promise<{ error: string | null }> => {
      const payload: Record<string, unknown> = {};
      if (fields.status !== undefined) payload.status = uiStatusToDB(fields.status);
      if (fields.assignedTo !== undefined) payload.assigned_to = fields.assignedTo;
      if (fields.teamId !== undefined) payload.team_id = fields.teamId;

      const { error: apiError } = await putMapCardApi(cardId, payload, founderOrgId ?? null);
      if (apiError) return { error: apiError };
      await fetchMapBoard();
      return { error: null };
    },
    [founderOrgId, fetchMapBoard],
  );

  useEffect(() => {
    fetchMapBoard();
  }, [fetchMapBoard]);

  useEffect(() => {
    const channel = supabase
      .channel("map-board-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "map_cards" }, () => {
        fetchMapBoard();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence" }, () => {
        fetchMapBoard();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchMapBoard]);

  return { columns, isLoading, error, refetch: fetchMapBoard, updateCardStatus, patchCard };
}

function mapPriority(priority: string): MAPCard["priority"] {
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}
