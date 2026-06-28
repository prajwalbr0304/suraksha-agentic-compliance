/** Prefer regulatory quote, then structured reason, then model narrative. */
export function pickObligationDetectionBody(row: {
  source_quote?: string | null;
  extraction_reason?: string | null;
  ai_explanation?: string | null;
  description?: string | null;
}): string | null {
  const a = row.source_quote?.trim();
  if (a) return a;
  const b = row.extraction_reason?.trim();
  if (b) return b;
  const c = row.ai_explanation?.trim();
  if (c) return c;
  const d = row.description?.trim();
  return d || null;
}

/** For MAP routing: prefer explicit extraction reason, then model explanation. */
export function pickAssignmentRationale(row: {
  extraction_reason?: string | null;
  ai_explanation?: string | null;
  source_quote?: string | null;
}): string | null {
  const a = row.extraction_reason?.trim();
  if (a) return a;
  const b = row.ai_explanation?.trim();
  if (b) return b;
  const c = row.source_quote?.trim();
  if (c) return c.length > 280 ? `${c.slice(0, 277)}…` : c;
  return null;
}
