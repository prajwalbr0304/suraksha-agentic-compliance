"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { uploadService, type UploadProgress } from "@/lib/services/upload.service";
import { supabase } from "@/lib/supabase/client";
import type { UploadFile } from "@/types";
import { useTenantApi } from "@/contexts/tenant-api-context";

// ---------------------------------------------------------------------------
// In-flight item (adds per-file progress tracking on top of UploadFile)
// ---------------------------------------------------------------------------

export interface UploadQueueItem extends UploadFile {
  progress: number;
  progressStage?: UploadProgress["stage"];
  progressMessage?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUpload() {
  const apiFetch = useTenantApi();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [recent, setRecent] = useState<UploadFile[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ── Load recent uploads on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoadingRecent(true);
      const data = await uploadService.getRecentUploads(20);
      if (!cancelled) {
        setRecent(data);
        setIsLoadingRecent(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    unsubscribeRef.current = uploadService.subscribe((updatedDoc) => {
      // Sync queue item status when the DB row changes
      setQueue((prev) =>
        prev.map((item) =>
          item.id === updatedDoc.id
            ? { ...item, ...updatedDoc, progress: updatedDoc.progress ?? item.progress }
            : item
        )
      );
      // Promote completed items into recent list
      if (updatedDoc.status === "completed") {
        setRecent((prev) => {
          const exists = prev.some((r) => r.id === updatedDoc.id);
          return exists ? prev.map((r) => (r.id === updatedDoc.id ? updatedDoc : r)) : [updatedDoc, ...prev];
        });
      }
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  // ── Upload handler ────────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (files: File[]) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserEmail = sessionData.session?.user?.email ?? "anonymous";

    for (const file of files) {
      // Add placeholder to queue immediately
      const placeholder: UploadQueueItem = {
        id: `pending-${crypto.randomUUID()}`,
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        type: file.type,
        status: "uploading",
        progress: 0,
        progressStage: "validating",
        progressMessage: "Queued…",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      };

      setQueue((prev) => [placeholder, ...prev]);

      const result = await uploadService.upload(
        file,
        currentUserEmail,
        (p) => {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === placeholder.id
                ? {
                    ...item,
                    progress: p.percent,
                    progressStage: p.stage,
                    progressMessage: p.message,
                    status:
                      p.stage === "complete"
                        ? "processing"
                        : p.stage === "error"
                        ? "failed"
                        : "uploading",
                  }
                : item
            )
          );
        },
        apiFetch
      );

      if (result.error) {
        // Mark as failed
        setQueue((prev) =>
          prev.map((item) =>
            item.id === placeholder.id
              ? { ...item, status: "failed", progress: 0, progressStage: "error", errorMessage: result.error }
              : item
          )
        );
      } else if (result.data) {
        const uploaded = result.data;
        // Replace placeholder with real record
        setQueue((prev) =>
          prev.map((item) =>
            item.id === placeholder.id
              ? { ...item, ...uploaded, progress: 100, progressStage: "complete" }
              : item
          )
        );
        // Add to recent list
        setRecent((prev) => [uploaded, ...prev.slice(0, 19)]);
      }
    }
  }, [apiFetch]);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status !== "processing" && item.status !== "completed"));
  }, []);

  return {
    queue,
    recent,
    isLoadingRecent,
    uploadFiles,
    removeFromQueue,
    clearCompleted,
  };
}
