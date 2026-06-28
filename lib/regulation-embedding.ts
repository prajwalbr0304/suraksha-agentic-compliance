import { createHash } from "crypto";

/** Deterministic 384-d embedding aligned with agent-service hashing_trick_384 (pgvector). */
export function hashingEmbedding384(text: string): number[] {
  const dim = 384;
  const v = new Array<number>(dim).fill(0);
  const normalized = (text || "").toLowerCase().trim();
  if (!normalized) {
    return v;
  }
  for (const w of normalized.split(/\s+/)) {
    if (!w) continue;
    const h = createHash("sha256").update(w, "utf8").digest("hex");
    const idx = Number.parseInt(h.slice(0, 12), 16) % dim;
    v[idx] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function embeddingToVectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => x.toFixed(8)).join(",")}]`;
}
