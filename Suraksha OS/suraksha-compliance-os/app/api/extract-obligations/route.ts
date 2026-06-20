/**
 * POST /api/extract-obligations
 *
 * Accepts a multipart/form-data request containing a PDF file and optional
 * metadata, extracts compliance obligations using local Ollama (llama3.1),
 * persists them in Supabase, and returns structured JSON.
 *
 * No API key required — runs entirely against the local Ollama server.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Request (multipart/form-data)                          │
 * │  ┣ file          File    — PDF to process (required)    │
 * │  ┣ document_id   string  — Supabase document row ID     │
 * │  └ uploaded_by   string  — User identifier              │
 * ├─────────────────────────────────────────────────────────┤
 * │  Response 200  ExtractionApiResponse                    │
 * │  Response 400  ExtractionApiError  (INVALID_FILE)       │
 * │  Response 422  ExtractionApiError  (PARSE_ERROR)        │
 * │  Response 502  ExtractionApiError  (AI_ERROR)           │
 * │  Response 500  ExtractionApiError  (DB_ERROR / other)   │
 * └─────────────────────────────────────────────────────────┘
 */

import { NextRequest, NextResponse } from "next/server";
import { pdfParserService } from "@/lib/services/pdf-parser.service";
import { extractionService } from "@/lib/services/extraction.service";
import { extractionPersistenceService } from "@/lib/services/extraction-persistence.service";
import { aiPipelineService } from "@/lib/services/ai-pipeline.service";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import type { ExtractionApiResponse, ExtractionApiError } from "@/types/extraction";

// ---------------------------------------------------------------------------
// Route segment config
// ---------------------------------------------------------------------------

/** Allow up to 10 minutes — local Ollama inference can be slow for large multi-chunk docs */
export const maxDuration = 600;

/** Force Node.js runtime so pdf-parse and Buffer APIs are available */
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/octet-stream", // some clients send PDF as octet-stream
]);

/** 25 MB — extraction is CPU/memory intensive; storage allows 50 MB */
const MAX_EXTRACTION_SIZE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Error factory helpers
// ---------------------------------------------------------------------------

function errorResponse(
  payload: ExtractionApiError,
  status: number
): NextResponse<ExtractionApiError> {
  return NextResponse.json(payload, { status });
}

/** Mark a document row as failed so the UI can surface the error state */
async function markDocumentFailed(documentId: string, reason: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase
      .from("documents")
      .update({ status: "failed", metadata: { failure_reason: reason, failed_at: new Date().toISOString() } })
      .eq("id", documentId);
  } catch {
    // best-effort — don't throw
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest
): Promise<NextResponse<ExtractionApiResponse | ExtractionApiError>> {
  // Canonical obligation extraction now runs through the Google ADK agent
  // pipeline (Gemini). This local Ollama-backed route is deprecated and only
  // enabled when ENABLE_LOCAL_EXTRACTION=1 (e.g. for offline/local dev).
  if (process.env.ENABLE_LOCAL_EXTRACTION !== "1") {
    return errorResponse(
      {
        success: false,
        error: "Local extraction is disabled. Obligation extraction runs via the AI agent pipeline (POST /api/agents/runs). Set ENABLE_LOCAL_EXTRACTION=1 to re-enable this legacy route.",
        code: "AI_ERROR",
      },
      503
    );
  }

  const principal = await requirePermission(request, "obligations.create");
  if (isAuthResponse(principal)) return principal as NextResponse<ExtractionApiError>;

  // ── 1. Parse multipart form data ────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      { success: false, error: "Request must be multipart/form-data.", code: "INVALID_FILE" },
      400
    );
  }

  const fileField = formData.get("file");
  if (!fileField || !(fileField instanceof File)) {
    return errorResponse(
      { success: false, error: 'Form field "file" is required and must be a file.', code: "INVALID_FILE" },
      400
    );
  }

  const documentId = formData.get("document_id");
  const uploadedBy = formData.get("uploaded_by");

  const file = fileField;
  const linkedDocumentId =
    typeof documentId === "string" && documentId.trim() ? documentId.trim() : null;

  // ── 2. Validate file ─────────────────────────────────────────────────────
  if (file.size === 0) {
    return errorResponse(
      { success: false, error: "Uploaded file is empty.", code: "INVALID_FILE" },
      400
    );
  }

  if (file.size > MAX_EXTRACTION_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return errorResponse(
      {
        success: false,
        error: `File is ${mb} MB. The extraction limit is 25 MB. Split large documents before uploading.`,
        code: "INVALID_FILE",
      },
      400
    );
  }

  // Accept by MIME type — also check filename for clients that send octet-stream
  const isAcceptedMime = ACCEPTED_MIME_TYPES.has(file.type);
  const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  if (!isAcceptedMime && !hasPdfExtension) {
    return errorResponse(
      {
        success: false,
        error: `File type "${file.type || "unknown"}" is not supported. Only PDF files can be processed for obligation extraction.`,
        code: "INVALID_FILE",
      },
      400
    );
  }

  // ── 3. Read into Buffer ──────────────────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // ── 4. Parse PDF text ────────────────────────────────────────────────────
  let parsedDoc: Awaited<ReturnType<typeof pdfParserService.parse>>;
  try {
    parsedDoc = await pdfParserService.parse(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown PDF parsing error.";
    return errorResponse(
      { success: false, error: `PDF parsing failed: ${message}`, code: "PARSE_ERROR" },
      422
    );
  }

  if (!parsedDoc.text || parsedDoc.wordCount < 10) {
    if (linkedDocumentId) await markDocumentFailed(linkedDocumentId, "No extractable text — may be a scanned/image PDF");
    return errorResponse(
      {
        success: false,
        error:
          "Could not extract readable text from this PDF. " +
          "The file may be scanned/image-based and requires OCR preprocessing.",
        code: "PARSE_ERROR",
      },
      422
    );
  }

  if (linkedDocumentId) {
    await aiPipelineService.persistDocumentChunks({
      documentId: linkedDocumentId,
      organizationId: principal.organizationId,
      text: parsedDoc.text,
    });
  }

  // ── 5. AI extraction ─────────────────────────────────────────────────────
  let extraction: Awaited<ReturnType<typeof extractionService.extractObligations>>;
  try {
    extraction = await extractionService.extractObligations(parsedDoc.text, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown AI extraction error.";

    // Surface Ollama connectivity issues clearly
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Ollama")) {
      if (linkedDocumentId) await markDocumentFailed(linkedDocumentId, "Ollama server not reachable — ensure `ollama serve` is running");
      return errorResponse(
        { success: false, error: "Ollama AI server is not running. Start it with: ollama serve", code: "MISSING_ENV" },
        500
      );
    }

    if (linkedDocumentId) await markDocumentFailed(linkedDocumentId, `AI extraction failed: ${message}`);
    return errorResponse(
      { success: false, error: `AI extraction failed: ${message}`, code: "AI_ERROR" },
      502
    );
  }

  // ── 6. Persist to Supabase (if document_id provided) ────────────────────
  let storedCount = 0;
  const warnings: string[] = [];

  if (linkedDocumentId) {
    try {
      const persistResult = await extractionPersistenceService.persist(
        extraction,
        linkedDocumentId,
        {
          organizationId: principal.organizationId,
          createdBy: principal.userId,
          requireReview: !principal.permissions.includes("obligations.approve"),
        }
      );
      storedCount = persistResult.stored_count;
      if (persistResult.errors.length > 0) {
        warnings.push(...persistResult.errors);
      }
    } catch (err) {
      // Persistence failure is non-fatal — return extraction results anyway
      const message = err instanceof Error ? err.message : "Unknown DB error.";
      warnings.push(`Supabase persistence failed: ${message}`);
    }
  }

  // ── 7. Return structured response ────────────────────────────────────────
  const response: ExtractionApiResponse = {
    success: true,
    document_id: linkedDocumentId,
    filename: file.name,
    extraction,
    stored_count: storedCount,
    ...(warnings.length > 0 && { warnings }),
  };

  return NextResponse.json(response, { status: 200 });
}

// ---------------------------------------------------------------------------
// GET — health-check / capability discovery
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  return NextResponse.json({
    endpoint: "POST /api/extract-obligations",
    description: "Extract compliance obligations from a PDF using local Ollama.",
    accepts: "multipart/form-data",
    fields: {
      file:        "File    — PDF document (required, max 25 MB)",
      document_id: "string  — Supabase documents.id to link (optional)",
      uploaded_by: "string  — user identifier for audit logging (optional)",
    },
    returns: "ExtractionApiResponse | ExtractionApiError",
  });
}
