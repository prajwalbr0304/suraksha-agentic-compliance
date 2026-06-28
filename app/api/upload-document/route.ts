/**
 * POST /api/upload-document
 *
 * Server-side handler for document uploads. Uses the service role key
 * to bypass RLS and write to both Supabase Storage and the documents table.
 *
 * The browser client POSTs multipart/form-data here instead of writing
 * directly to Supabase Storage (which requires storage RLS policies).
 *
 * Request (multipart/form-data):
 *   file         File    — the document to upload (required)
 *   uploaded_by  string  — user identifier (optional, defaults to "anonymous")
 *
 * Response 200: { id, name, size, storage_path, status }
 * Response 400: { error: string }
 * Response 500: { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission, withOrg } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET ?? "compliance-documents";
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/tiff",
  "image/png",
  "image/jpeg",
  "application/octet-stream", // some browsers send PDF as this
]);

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "documents.upload");
  if (isAuthResponse(principal)) return principal;

  // ── 1. Parse form data ────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Request must be multipart/form-data" }, { status: 400 });
  }

  const fileField = form.get("file");
  if (!fileField || !(fileField instanceof File)) {
    return NextResponse.json({ error: 'Field "file" is required' }, { status: 400 });
  }

  const file = fileField;
  const uploadedBy = principal.email || ((form.get("uploaded_by") as string | null) ?? "anonymous");

  // ── 2. Validate ───────────────────────────────────────────────────────────
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File size ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 50 MB limit` },
      { status: 400 }
    );
  }
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  if (!ACCEPTED_MIME.has(file.type) && !isPdf) {
    return NextResponse.json(
      { error: `File type "${file.type}" is not supported. Accepted: PDF, DOCX, TIFF, PNG, JPEG` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  // ── 3. Upload to Storage (service role bypasses RLS) ────────────────────
  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `uploads/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });

  if (storageError) {
    console.error("[upload-document] Storage error:", storageError.message);
    return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 });
  }

  // ── 4. Insert document record ────────────────────────────────────────────
  const mimeLabel: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "image/tiff": "TIFF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
  };

  const { data: docRow, error: dbError } = await supabase
    .from("documents")
    .insert(withOrg(principal, {
      name: file.name,
      size: file.size,
      mime_type: file.type || "application/pdf",
      storage_path: storagePath,
      status: "processing",
      obligations_extracted: 0,
      confidence_score: 0,
      uploaded_by: uploadedBy,
      metadata: {
        fileLabel: mimeLabel[file.type] ?? "FILE",
        lastModified: new Date().toISOString(),
        classification: "internal",
      },
    }))
    .select()
    .single();

  if (dbError || !docRow) {
    // Clean up storage upload if DB insert fails
    await supabase.storage.from(BUCKET).remove([storagePath]);
    console.error("[upload-document] DB error:", dbError?.message);
    return NextResponse.json({ error: dbError?.message ?? "Failed to save document record" }, { status: 500 });
  }

  // ── 5. Log to audit trail ─────────────────────────────────────────────────
  await writeAudit(supabase, principal, {
    action: "document_uploaded",
    target: file.name,
    targetId: (docRow as Record<string, unknown>).id as string,
    details: `Uploaded document: ${file.name}`,
    metadata: {
      size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
      type: mimeLabel[file.type] ?? "FILE",
    },
  });

  // ── 6. Kick off extraction in the background (non-blocking) ─────────────
  // We use setImmediate to defer extraction so this response returns immediately.
  // Extraction runs as a long-lived background task in the same Node.js process.
  const documentId = (docRow as Record<string, unknown>).id as string;
  const fileBuffer = buffer; // already in memory
  const fileName = file.name;

  setImmediate(() => {
    (async () => {
      try {
        const { pdfParserService } = await import("@/lib/services/pdf-parser.service");
        const { extractionService } = await import("@/lib/services/extraction.service");
        const { extractionPersistenceService } = await import("@/lib/services/extraction-persistence.service");
        const { aiPipelineService } = await import("@/lib/services/ai-pipeline.service");

        const parsed = await pdfParserService.parse(fileBuffer);
        if (!parsed.text || parsed.wordCount < 10) {
          await supabase.from("documents").update({
            status: "failed",
            metadata: { failure_reason: "No extractable text — may be scanned/image PDF" },
          }).eq("id", documentId);
          return;
        }

        await aiPipelineService.persistDocumentChunks({
          documentId,
          organizationId: principal.organizationId,
          text: parsed.text,
        });

        const extraction = await extractionService.extractObligations(parsed.text, fileName);
        await extractionPersistenceService.persist(extraction, documentId, {
          organizationId: principal.organizationId,
          createdBy: principal.userId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[upload-document] Background extraction failed:", msg);
        await supabase.from("documents").update({
          status: "failed",
          metadata: { failure_reason: msg },
        }).eq("id", documentId);
      }
    })();
  });

  return NextResponse.json({
    id: documentId,
    name: file.name,
    size: file.size,
    storage_path: storagePath,
    status: "processing",
  });
}
