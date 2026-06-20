import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface DocumentChunkInput {
  documentId: string;
  organizationId?: string | null;
  text: string;
  chunkSize?: number;
}

export interface PipelineCapability {
  name: string;
  status: "active" | "planned";
  tool: string;
  purpose: string;
}

const DEFAULT_CHUNK_SIZE = 1_200;

export const AI_PIPELINE_CAPABILITIES: PipelineCapability[] = [
  {
    name: "Structured parsing",
    status: "planned",
    tool: "IBM Docling",
    purpose: "Preserve pages, sections, tables, and citations before extraction.",
  },
  {
    name: "OCR fallback",
    status: "planned",
    tool: "Tesseract OCR or PaddleOCR",
    purpose: "Handle scanned RBI/SEBI/PMLA circulars that pdf-parse cannot read.",
  },
  {
    name: "Local extraction",
    status: "active",
    tool: "Ollama",
    purpose: "Extract obligations without sending confidential documents outside the bank.",
  },
  {
    name: "Vector retrieval",
    status: "planned",
    tool: "Supabase pgvector or Qdrant",
    purpose: "Support citation-backed compliance Q&A, semantic drift, and evidence matching.",
  },
];

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > chunkSize && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export const aiPipelineService = {
  async persistDocumentChunks({
    documentId,
    organizationId,
    text,
    chunkSize = DEFAULT_CHUNK_SIZE,
  }: DocumentChunkInput): Promise<number> {
    const chunks = splitIntoChunks(text, chunkSize);
    if (chunks.length === 0) return 0;

    const supabase = getSupabaseServerClient();
    const rows = chunks.map((content, index) => ({
      document_id: documentId,
      chunk_index: index,
      page_number: null,
      section_ref: null,
      citation: `chunk-${index + 1}`,
      content,
      metadata: {
        parser: "pdf-parse",
        embedding_status: "pending",
        ocr_status: "not_required",
      },
      ...(organizationId && { organization_id: organizationId }),
    }));

    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase
        .from("document_chunks")
        .upsert(rows.slice(i, i + 50), { onConflict: "document_id,chunk_index" });
      if (error) {
        console.warn("[ai-pipeline] chunk persistence failed:", error.message);
        return i;
      }
    }

    return rows.length;
  },

  capabilities(): PipelineCapability[] {
    return AI_PIPELINE_CAPABILITIES;
  },
};
