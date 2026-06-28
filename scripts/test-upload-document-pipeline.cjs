/**
 * End-to-end check: sign in as bank manager → POST /api/upload-document → wait for
 * background extraction (Ollama + obligation persistence) → verify documents + obligations.
 *
 * Prerequisites:
 *   - Next.js dev server: npm run dev (default http://localhost:3000)
 *   - Ollama running with model from .env (e.g. qwen2.5:1.5b) — upload extraction uses extraction.service.ts → Ollama
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Credentials (override with env for CI / other tenants):
 *   SURAKSHA_UPLOAD_TEST_EMAIL   (default: manager@testbank.com)
 *   SURAKSHA_UPLOAD_TEST_PASSWORD (default: anekal123)
 *   SURAKSHA_TEST_ORG_SLUG       (default: test-cooperative-bank) — must match an org this user belongs to
 *   SURAKSHA_TEST_BASE_URL       (default: http://localhost:3000)
 *
 * Usage:
 *   node scripts/test-upload-document-pipeline.cjs "C:\path\to\file.pdf"
 *   SURAKSHA_TEST_PDF_PATH="C:\path\to\file.pdf" node scripts/test-upload-document-pipeline.cjs
 *
 * npm:
 *   npm run test:upload-pipeline -- "C:\path\to\file.pdf"
 */
const fs = require("node:fs");
const path = require("node:path");
const { File } = require("node:buffer");

const root = process.cwd();

function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const BASE_URL = (process.env.SURAKSHA_TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL =
  process.env.SURAKSHA_UPLOAD_TEST_EMAIL || process.env.E2E_MANAGER_EMAIL || "manager@testbank.com";
const PASSWORD =
  process.env.SURAKSHA_UPLOAD_TEST_PASSWORD || process.env.E2E_MANAGER_PASSWORD || "anekal123";
const ORG_SLUG = process.env.SURAKSHA_TEST_ORG_SLUG || "test-cooperative-bank";

function restHeaders(accessToken) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function signInWithPassword() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.msg || body.error_description || body.error || `Auth failed HTTP ${res.status}`);
  }
  if (!body.access_token || !body.user?.id) {
    throw new Error("Auth response missing access_token or user.id");
  }
  return { accessToken: body.access_token, userId: body.user.id };
}

async function resolveOrganizationId(accessToken, userId) {
  const q = new URLSearchParams({
    select: "organization_id,organizations(slug,name)",
    user_id: `eq.${userId}`,
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/organization_members?${q}`, {
    headers: restHeaders(accessToken),
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(typeof rows === "object" && rows.message ? rows.message : `membership HTTP ${res.status}`);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No organization_members row for this user — check seed / invite.");
  }
  const bySlug = rows.find((r) => r.organizations?.slug === ORG_SLUG);
  const pick = bySlug || rows[0];
  const slug = pick.organizations?.slug || ORG_SLUG;
  const name = pick.organizations?.name || "";
  if (!pick.organization_id) throw new Error("Missing organization_id on membership");
  console.log(`Using organization: ${slug}${name ? ` (${name})` : ""} — id ${pick.organization_id}`);
  return pick.organization_id;
}

async function uploadPdf(accessToken, orgId, pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const name = path.basename(pdfPath);
  const fd = new FormData();
  fd.append("file", new File([buf], name, { type: "application/pdf" }));

  const res = await fetch(`${BASE_URL}/api/upload-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-suraksha-org-id": orgId,
    },
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Upload HTTP ${res.status}`);
  }
  if (!body.id) throw new Error("Upload response missing document id");
  return { documentId: body.id, name: body.name };
}

async function getDocument(accessToken, documentId) {
  const q = new URLSearchParams({
    select: "id,status,obligations_extracted,confidence_score,metadata",
    id: `eq.${documentId}`,
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/documents?${q}`, { headers: restHeaders(accessToken) });
  const rows = await res.json();
  if (!res.ok || !Array.isArray(rows) || !rows[0]) return null;
  return rows[0];
}

async function countObligationsForDocument(accessToken, documentId) {
  const url = `${SUPABASE_URL}/rest/v1/obligations?document_id=eq.${documentId}&select=id`;
  const res = await fetch(url, {
    method: "HEAD",
    headers: { ...restHeaders(accessToken), Prefer: "count=exact" },
  });
  const cr = res.headers.get("content-range");
  if (cr && cr.includes("/")) {
    const total = cr.split("/")[1];
    const n = parseInt(total, 10);
    return Number.isFinite(n) ? n : 0;
  }
  const res2 = await fetch(`${url}&limit=500`, { headers: restHeaders(accessToken) });
  const rows = await res2.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function main() {
  const pdfArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const pdfPath = pdfArg
    ? path.isAbsolute(pdfArg)
      ? pdfArg
      : path.join(root, pdfArg)
    : process.env.SURAKSHA_TEST_PDF_PATH
      ? path.isAbsolute(process.env.SURAKSHA_TEST_PDF_PATH)
        ? process.env.SURAKSHA_TEST_PDF_PATH
        : path.join(root, process.env.SURAKSHA_TEST_PDF_PATH)
      : null;

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local).");
    process.exit(1);
  }
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error("Provide a PDF path as the first argument, or set SURAKSHA_TEST_PDF_PATH in .env.local.");
    console.error("Example:");
    console.error('  node scripts/test-upload-document-pipeline.cjs "C:\\Users\\you\\Desktop\\doc.pdf"');
    process.exit(1);
  }

  console.log("--- Upload pipeline test ---");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`PDF: ${pdfPath}`);
  console.log(`Sign-in user: ${EMAIL}`);
  console.log("");

  const { accessToken, userId } = await signInWithPassword();
  console.log("Signed in OK.");

  const orgId = await resolveOrganizationId(accessToken, userId);

  console.log("Uploading…");
  const { documentId, name } = await uploadPdf(accessToken, orgId, pdfPath);
  console.log(`Upload accepted: document id=${documentId} name=${JSON.stringify(name)}`);

  const maxWaitMs = 15 * 60 * 1000;
  const stepMs = 4000;
  const started = Date.now();
  let lastStatus = "";

  while (Date.now() - started < maxWaitMs) {
    const doc = await getDocument(accessToken, documentId);
    if (doc) {
      if (doc.status !== lastStatus) {
        console.log(`  [${new Date().toISOString()}] status=${doc.status} obligations_extracted=${doc.obligations_extracted ?? "?"}`);
        lastStatus = doc.status;
      }
      if (doc.status === "processed") {
        const oblCount = await countObligationsForDocument(accessToken, documentId);
        console.log("");
        console.log("SUCCESS: document status=processed");
        console.log(`  obligations_extracted (column): ${doc.obligations_extracted}`);
        console.log(`  obligations rows (document_id): ${oblCount}`);
        console.log(`  confidence_score: ${doc.confidence_score}`);
        console.log("");
        console.log("Open UI:", `${BASE_URL}/dashboard/${ORG_SLUG}/documents`);
        return;
      }
      if (doc.status === "failed") {
        console.error("FAILED: document extraction failed.");
        console.error("  metadata:", JSON.stringify(doc.metadata || {}, null, 2));
        console.error("Tip: start Ollama and pull the model from .env (OLLAMA_MODEL / OLLAMA_BASE_URL).");
        process.exit(2);
      }
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }

  console.error("TIMEOUT: document did not reach processed/failed within 15 minutes.");
  console.error("Check Next.js terminal for [upload-document] Background extraction logs.");
  process.exit(3);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
