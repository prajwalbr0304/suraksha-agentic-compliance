/**
 * PDF Parser Service
 *
 * Extracts text content from a raw PDF buffer using pdf-parse v1.
 *
 * SERVER-ONLY — uses Node.js Buffer API.
 * Must only be imported from API routes or Server Components.
 *
 * pdf-parse v1 API: `pdf(buffer, options?)` returns a Promise.
 * Dynamic import keeps it out of the client bundle and avoids the
 * fs.readFileSync test-file error that occurs during Next.js builds.
 */

import type { ParsedDocument } from "@/types/extraction";

type PdfParseFn = (
  buffer: Buffer,
  options?: { max?: number }
) => Promise<{ text: string; numpages: number; info: unknown }>;

/**
 * Validate that a buffer begins with the PDF magic bytes (%PDF).
 */
function hasPdfMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46    // F
  );
}

export const pdfParserService = {
  async parse(buffer: Buffer): Promise<ParsedDocument> {
    if (!hasPdfMagicBytes(buffer)) {
      throw new Error(
        "Buffer does not start with the PDF magic bytes (%PDF). " +
          "Ensure the file is a valid PDF."
      );
    }

    // Dynamic import — pdf-parse v1 exports a single callable function.
    // Normalise CJS/ESM interop so it always resolves to the function.
    const mod = await import("pdf-parse");
    const pdfParse = (
      typeof mod === "function"
        ? mod
        : typeof (mod as { default?: unknown }).default === "function"
          ? (mod as { default: PdfParseFn }).default
          : (mod as unknown as PdfParseFn)
    ) as PdfParseFn;

    // max: 0 tells pdf-parse not to load any test PDFs during module init
    const data = await pdfParse(buffer, { max: 0 });

    const text = (data.text ?? "").trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return {
      text,
      numPages: data.numpages ?? 0,
      wordCount,
      info: (data.info as Record<string, unknown>) ?? {},
    };
  },
};


