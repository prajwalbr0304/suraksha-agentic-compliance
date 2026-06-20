/**
 * Extraction API — request / response types
 *
 * Shared between the API route, extraction service, and persistence service.
 * Contains no framework dependencies so it is safe to import anywhere.
 */

// ---------------------------------------------------------------------------
// Shared literal unions
// ---------------------------------------------------------------------------

export type ExtractionPriority = "critical" | "high" | "medium" | "low";
export type ExtractionRisk = "critical" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Core extraction output
// ---------------------------------------------------------------------------

/**
 * A single compliance obligation extracted from a regulatory document by GPT-4.1.
 */
export interface ExtractedObligation {
  /** Full text of the obligation (exact quote or precise paraphrase) */
  obligation_text: string;
  /** Responsible department (e.g. "Finance", "IT", "Compliance") */
  department: string;
  /** Compliance priority */
  priority: ExtractionPriority;
  /** ISO 8601 date string, or null if no explicit deadline is stated */
  deadline: string | null;
  /** Evidence items required to demonstrate compliance */
  evidence_required: string[];
  /** Regulatory citation — section, article, or paragraph reference */
  citation: string;
  /** Model confidence in the accuracy of this extraction (0–100) */
  confidence: number;
  /** Risk level if this obligation is not met */
  compliance_risk: ExtractionRisk;
}

/**
 * The full result of one AI extraction run over a document.
 */
export interface ExtractionResult {
  obligations: ExtractedObligation[];
  document_summary: string;
  regulation_name: string;
  jurisdiction: string;
  total_found: number;
  /** Wall-clock time from service call to parsed response (ms) */
  processing_time_ms: number;
}

// ---------------------------------------------------------------------------
// PDF parsing output
// ---------------------------------------------------------------------------

/**
 * Raw output from the PDF parser — text plus document metadata.
 */
export interface ParsedDocument {
  text: string;
  numPages: number;
  wordCount: number;
  /** pdf-parse `info` object (author, title, creation date, etc.) */
  info: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API request (multipart/form-data fields)
// ---------------------------------------------------------------------------

/**
 * Fields accepted by POST /api/extract-obligations.
 *
 * Clients must send multipart/form-data. The `file` field is required.
 * `document_id` links the extraction to an existing row in the documents table.
 */
export interface ExtractionRequestFields {
  /** The PDF file to extract obligations from */
  file: File;
  /** Optional — Supabase documents.id to associate extracted obligations with */
  document_id?: string;
  /** Optional — user identifier for audit logging */
  uploaded_by?: string;
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

/** Successful response body for POST /api/extract-obligations */
export interface ExtractionApiResponse {
  success: true;
  /** Supabase documents.id linked to this extraction, if provided */
  document_id: string | null;
  filename: string;
  extraction: ExtractionResult;
  /** Number of obligation rows successfully written to Supabase */
  stored_count: number;
  /** Non-fatal warnings (e.g. individual row failures) */
  warnings?: string[];
}

/** Error response body for POST /api/extract-obligations */
export interface ExtractionApiError {
  success: false;
  error: string;
  code:
    | "INVALID_FILE"     // file type / size validation failed
    | "PARSE_ERROR"      // pdf-parse threw an error
    | "AI_ERROR"         // OpenAI call failed
    | "DB_ERROR"         // Supabase insert failed completely
    | "MISSING_ENV"      // required environment variable not set
    | "INTERNAL_ERROR";  // unexpected error
}
