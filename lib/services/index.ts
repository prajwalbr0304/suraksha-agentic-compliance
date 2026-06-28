/**
 * Services barrel export
 *
 * Import services like:
 *   import { obligationsService, uploadService } from "@/lib/services";
 */
export { obligationsService } from "./obligations.service";
export { uploadService } from "./upload.service";
export { auditService } from "./audit.service";
export { analyticsService } from "./analytics.service";
// Server-only services (API routes / Server Components only)
export { extractionService } from "./extraction.service";
export { pdfParserService } from "./pdf-parser.service";
export { extractionPersistenceService } from "./extraction-persistence.service";
