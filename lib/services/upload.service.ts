/**
 * Upload / Storage Service (Production)
 *
 * Full pipeline:
 *  1. Client-side PDF/MIME validation + magic-byte check
 *  2. Server-side API route (/api/upload-document) handles storage + DB insert
 *     using service role key — bypasses RLS entirely
 *  3. Extraction triggered via /api/extract-obligations using the in-memory File
 *  4. Realtime subscription for status updates
 */
import { supabase } from "@/lib/supabase/client";
import { authFetch } from "@/lib/auth/client";
import type { DocumentRow } from "@/lib/supabase/database.types";
import type { UploadFile } from "@/types";

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET ?? "compliance-documents";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/tiff",
  "image/png",
  "image/jpeg",
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function validateFile(file: File): ValidationResult {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `"${file.type || "unknown"}" is not supported. Accepted: PDF, DOCX, DOC, TIFF, PNG, JPEG.`,
    };
  }
  if (file.size === 0) return { valid: false, error: "File is empty." };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File size (${formatBytes(file.size)}) exceeds the 50 MB limit.` };
  }
  return { valid: true };
}

/** Reads the first 4 bytes to verify PDF magic header (%PDF) */
export async function validatePdfMagicBytes(file: File): Promise<ValidationResult> {
  if (file.type !== "application/pdf") return { valid: true };
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer);
      const header = String.fromCharCode(...arr.subarray(0, 4));
      resolve(
        header === "%PDF"
          ? { valid: true }
          : { valid: false, error: "File does not appear to be a valid PDF (invalid header)." }
      );
    };
    reader.onerror = () => resolve({ valid: false, error: "Could not read file for validation." });
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}

// ---------------------------------------------------------------------------
// Shape adapters
// ---------------------------------------------------------------------------

export function rowToUploadFile(row: DocumentRow): UploadFile {
  return {
    id: row.id,
    name: row.name,
    size: formatBytes(row.size),
    type: row.mime_type,
    status: mapDocStatus(row.status),
    progress: row.status === "processed" ? 100 : row.status === "processing" ? 60 : 0,
    obligationsFound: row.obligations_extracted,
    confidence: row.confidence_score > 0 ? row.confidence_score : undefined,
    timestamp: new Date(row.uploaded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };
}

function mapDocStatus(status: DocumentRow["status"]): UploadFile["status"] {
  const map: Record<DocumentRow["status"], UploadFile["status"]> = {
    queued: "uploading",
    processing: "processing",
    processed: "completed",
    failed: "failed",
  };
  return map[status];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileLabel(mimeType: string): string {
  const labels: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "image/tiff": "TIFF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
  };
  return labels[mimeType] ?? "FILE";
}

// ---------------------------------------------------------------------------
// Progress types
// ---------------------------------------------------------------------------

export interface UploadResult {
  data: UploadFile | null;
  error?: string;
}

export interface UploadProgress {
  stage: "validating" | "uploading" | "saving" | "complete" | "error";
  percent: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const uploadService = {
  /**
   * Full upload pipeline with validation, storage, DB insert, and extraction trigger.
   */
  async upload(
    file: File,
    uploadedBy: string,
    onProgress?: (p: UploadProgress) => void,
    apiFetch: typeof authFetch = authFetch
  ): Promise<UploadResult> {
    const emit = (stage: UploadProgress["stage"], percent: number, message: string) =>
      onProgress?.({ stage, percent, message });

    // ── 1. Validate ──────────────────────────────────────────────────────────
    emit("validating", 5, "Validating document…");
    const typeCheck = validateFile(file);
    if (!typeCheck.valid) return { data: null, error: typeCheck.error };
    const magicCheck = await validatePdfMagicBytes(file);
    if (!magicCheck.valid) return { data: null, error: magicCheck.error };
    emit("validating", 15, "Validation passed");

    // ── 2. Upload via server-side API route (uses service role — bypasses RLS) ──
    emit("uploading", 20, "Uploading to secure storage…");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("uploaded_by", uploadedBy);

    let uploadedDocId: string;

    try {
      const res = await apiFetch("/api/upload-document", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { data: null, error: body.error ?? "Upload failed" };
      }

      const result = await res.json() as { id: string; storage_path: string; name: string; size: number };
      uploadedDocId = result.id;
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : "Upload request failed" };
    }

    emit("uploading", 70, "Stored in secure bucket");

    // ── 3. Fetch the created document row from DB for UI ─────────────────────
    emit("saving", 80, "Saving document metadata…");

    const { data: row } = await supabase
      .from("documents")
      .select("*")
      .eq("id", uploadedDocId)
      .single() as unknown as { data: DocumentRow | null };

    // Extraction is now triggered server-side inside /api/upload-document
    // via setImmediate — no client-side extraction call needed.
    emit("complete", 100, "Document queued for AI extraction");

    return {
      data: row
        ? rowToUploadFile(row)
        : {
            id: uploadedDocId,
            name: file.name,
            size: formatBytes(file.size),
            type: getFileLabel(file.type),
            status: "processing",
            progress: 100,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          },
    };
  },

  async _triggerExtraction(documentId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("document_id", documentId);

    const res = await authFetch("/api/extract-obligations", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[UploadService] Extraction returned error:", body);
    }
  },

  /** Graceful degradation for environments without a live Supabase bucket */
  async _mockFlow(
    file: File,
    _uploadedBy: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<UploadResult> {
    const emit = (stage: UploadProgress["stage"], percent: number, message: string) =>
      onProgress?.({ stage, percent, message });

    const steps: [number, string][] = [
      [30, "Uploading to secure storage…"],
      [55, "Transferring document…"],
      [75, "Verifying integrity…"],
      [90, "Saving metadata…"],
    ];
    for (const [pct, msg] of steps) {
      await new Promise((r) => setTimeout(r, 350));
      emit("uploading", pct, msg);
    }
    await new Promise((r) => setTimeout(r, 400));
    emit("complete", 100, "Document queued for extraction (demo mode)");

    return {
      data: {
        id: `mock-${crypto.randomUUID()}`,
        name: file.name,
        size: formatBytes(file.size),
        type: getFileLabel(file.type),
        status: "processing",
        progress: 100,
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      },
    };
  },

  async getRecentUploads(limit = 10): Promise<UploadFile[]> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(limit) as unknown as {
        data: DocumentRow[] | null;
        error: { message: string } | null;
      };

    if (error || !data) {
      console.warn("[UploadService] Using mock data —", error?.message);
      return [];
    }
    return data.map(rowToUploadFile);
  },

  async getSignedDownloadUrl(storagePath: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },

  async deleteDocument(id: string, storagePath: string): Promise<{ success: boolean; error?: string }> {
    const [{ error: storageErr }, { error: dbErr }] = await Promise.all([
      supabase.storage.from(BUCKET).remove([storagePath]),
      supabase.from("documents").delete().eq("id", id) as unknown as {
        error: { message: string } | null;
      },
    ]);
    const err = storageErr?.message ?? (dbErr as { message: string } | null)?.message;
    return err ? { success: false, error: err } : { success: true };
  },

  subscribe(onUpdate: (doc: UploadFile) => void): () => void {
    const channel = supabase
      .channel("documents-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "documents" },
        (payload) => {
          onUpdate(rowToUploadFile(payload.new as DocumentRow));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};
