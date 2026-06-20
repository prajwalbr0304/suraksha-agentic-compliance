/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Smoke-test public.match_regulation_chunks via supabase-js RPC (same shapes as /api/regulation-center/search).
 *
 * Run from repo root: node scripts/test-match-regulation-chunks.cjs
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();

function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function hashingEmbedding384(text) {
  const dim = 384;
  const v = new Array(dim).fill(0);
  const normalized = String(text || "")
    .toLowerCase()
    .trim();
  if (!normalized) return v;
  for (const w of normalized.split(/\s+/)) {
    if (!w) continue;
    const h = crypto.createHash("sha256").update(w, "utf8").digest("hex");
    const idx = Number.parseInt(h.slice(0, 12), 16) % dim;
    v[idx] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function embeddingToVectorLiteral(vec) {
  return `[${vec.map((x) => x.toFixed(8)).join(",")}]`;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("status", "active")
    .limit(1);
  if (orgErr || !orgs?.length) {
    console.error("Could not load organization:", orgErr?.message || "no rows");
    process.exit(1);
  }
  const orgId = orgs[0].id;
  console.log("Using organization_id:", orgId);

  const vec = hashingEmbedding384("KYC circular RBI");
  const literal = embeddingToVectorLiteral(vec);
  console.log("Vector dims:", vec.length, "| literal length:", literal.length);

  const payloads = [
    { name: "string_bracket_literal", args: { query_embedding: literal, p_organization_id: orgId, match_count: 5 } },
    { name: "number_array", args: { query_embedding: vec, p_organization_id: orgId, match_count: 5 } },
  ];

  for (const { name, args } of payloads) {
    const { data, error } = await supabase.rpc("match_regulation_chunks", args);
    if (error) {
      console.log(`FAIL [${name}]:`, error.message, error.code || "", error.details || "");
    } else {
      console.log(`OK [${name}]:`, Array.isArray(data) ? `${data.length} row(s)` : typeof data, data);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
