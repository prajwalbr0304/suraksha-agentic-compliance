/**
 * Obligation Extraction Service
 *
 * Sends regulatory document text to a local Ollama instance and parses the
 * structured JSON response into typed ExtractedObligation objects.
 *
 * SERVER-ONLY - runs against the local Ollama server (http://localhost:11434).
 * No API key required. No rate limits. Runs 100% offline.
 *
 * Ollama must be running: `ollama serve`
 * Model must be pulled:   `ollama pull llama3.1`
 */

import * as http from "node:http";
import type {
  ExtractedObligation,
  ExtractionResult,
  ExtractionPriority,
  ExtractionRisk,
} from "@/types/extraction";
import {
  dedupeExtractedObligations,
  resolveDepartment,
} from "@/lib/obligation-extraction-helpers";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

// qwen2.5:1.5b is ~986MB, runs at ~15-20 tok/sec on CPU (vs llama3.1 at ~3 tok/sec).
// Excellent at structured JSON output. Override with OLLAMA_MODEL env var.
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

// Chunk size: 3K chars = fewer obligations per chunk = faster per-chunk output (~3-5 min on CPU).
const MAX_CHARS_PER_CHUNK = 3_000;
const MAX_INPUT_CHARS = 400_000;
// Limit how many chunks to process. 0 = unlimited. Set OLLAMA_MAX_CHUNKS=2 for quick tests.
const MAX_CHUNKS = process.env.OLLAMA_MAX_CHUNKS ? parseInt(process.env.OLLAMA_MAX_CHUNKS) : 0;

const VALID_PRIORITIES = new Set<string>(["critical", "high", "medium", "low"]);
const VALID_RISKS = new Set<string>(["critical", "high", "medium", "low"]);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior banking compliance officer at a regulated Indian bank with 20+ years of experience interpreting RBI, SEBI, PMLA, and other regulatory frameworks.

Your sole task: read the provided regulatory circular or directive and extract every distinct, MEASURABLE compliance obligation that requires a bank to take action, implement a control, submit a report, or maintain evidence.

EXTRACTION RULES
----------------
1. Extract ONLY actionable obligations - directives that require the bank to DO something, STOP something, REPORT something, or MAINTAIN something. Skip recitals, background context, and definitions unless they contain a direct obligation.
2. Every obligation must be independently verifiable by an auditor. If it cannot be audited, it is not an obligation.
3. Resolve relative deadlines (e.g. "within 30 days of the date of this circular") to absolute ISO 8601 dates based on the circular issue date. If the issue date is not in the document, set deadline to null.
4. For each obligation, identify the MINIMUM audit evidence package that would satisfy an RBI inspection.
5. Assign priority using this rubric:
     critical -> regulatory penalty, licence suspension, or criminal liability if missed
     high     -> reportable breach, significant supervisory concern, or systemic risk
     medium   -> operational or governance gap with moderate supervisory impact
     low      -> best-practice requirement or minor administrative obligation
6. Assign compliance_risk using the same rubric applied to the consequence of NON-COMPLIANCE.
7. Department must be the OWNING department (one primary owner). Choose from: "Legal", "Finance", "IT", "Operations", "HR", "Risk Management", "Compliance", "Internal Audit", "Treasury", "Customer Service", "Fraud & AML", "Credit".
   Do NOT default everything to Compliance. Use "Credit" for NPA/classification, lending, risk weights on exposures, provisioning on advances, and NBFC/bank credit rules. Use "Risk Management" for model risk policy, model inventory, stress testing, ICAAP, and macro-prudential risk. Use "IT" for cyber, IT governance, systems, and data-centre controls. Use "Fraud & AML" for PMLA/KYC/sanctions. Use "Treasury" for liquidity and ALCO. Reserve "Compliance" for bank-wide regulatory liaison, board-level policy registers, and obligations that are explicitly compliance-owned.
8. confidence reflects your certainty that the extraction is accurate and complete (0-100).

OUTPUT FORMAT - for EACH obligation produce a JSON object with exactly these fields:
  obligation_text   - Verbatim quote from the circular or faithful paraphrase up to 400 words. Begin with an action verb.
  department        - Single owning department (see rule 7)
  priority          - "critical" | "high" | "medium" | "low"
  deadline          - ISO 8601 date YYYY-MM-DD, or null if no deadline is stated
  evidence_required - JSON array of specific, auditable artefacts. Minimum 1 item.
  citation          - Exact section/paragraph reference (e.g. "Para 3.1(ii)")
  confidence        - Integer 0-100
  compliance_risk   - "critical" | "high" | "medium" | "low"

TOP-LEVEL FIELDS (always required):
  regulation_name   - Full official title of the circular/direction/notification
  jurisdiction      - e.g. "India - RBI", "India - SEBI", "India - PMLA/FIU-IND"
  document_summary  - 3-4 sentences covering: purpose, scope, primary obligations, and compliance timeline

IMPORTANT
---------
Return ONLY a valid JSON object. Zero markdown, zero prose before or after the JSON.
The "obligations" key holds a JSON array. Do NOT omit any measurable obligation.
Sort obligations by priority descending (critical first, then high, medium, low).`;

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

function sanitizeObligation(raw: Record<string, unknown>): ExtractedObligation {
  const obligation_text = String(raw.obligation_text ?? "").trim();
  const citation = String(raw.citation ?? "").trim();
  return {
    obligation_text,
    department: resolveDepartment(raw.department, obligation_text, citation),
    priority: (VALID_PRIORITIES.has(String(raw.priority))
      ? raw.priority
      : "medium") as ExtractionPriority,
    deadline:
      typeof raw.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)
        ? raw.deadline
        : null,
    evidence_required: Array.isArray(raw.evidence_required)
      ? (raw.evidence_required as unknown[]).map(String).filter(Boolean)
      : [],
    citation,
    confidence: Math.min(100, Math.max(0, Number(raw.confidence) || 70)),
    compliance_risk: (VALID_RISKS.has(String(raw.compliance_risk))
      ? raw.compliance_risk
      : "medium") as ExtractionRisk,
  };
}

// ---------------------------------------------------------------------------
// Ollama API call
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callOllama(
  model: string,
  messages: OllamaMessage[],
  timeoutMs = 1_800_000 // 30 min hard ceiling
): Promise<string> {
  // Use streaming=true so each generated token keeps the connection alive.
  // This prevents any socket-idle timeout regardless of how slow CPU inference is.
  const body = JSON.stringify({
    model,
    messages,
    stream: true, // stream tokens — connection stays alive the whole time
    format: "json",
    options: {
      temperature: 0.1,
      num_predict: 768, // 3K chunk → ~2-3 obligations → ~400 tokens. 768 gives safety margin.
    },
  });

  const ollamaUrl = new URL(OLLAMA_BASE_URL);
  const hostname = ollamaUrl.hostname;
  const port = Number(ollamaUrl.port) || 11434;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const done = (val: string | Error) => {
      if (settled) return;
      settled = true;
      if (val instanceof Error) reject(val);
      else resolve(val);
    };

    // Hard wall-clock timeout
    const wallTimer = setTimeout(
      () => done(new Error(`Ollama timed out after ${timeoutMs / 60000} min`)),
      timeoutMs
    );

    const req = http.request(
      {
        hostname,
        port,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "keep-alive",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errData = "";
          res.on("data", (c: Buffer) => { errData += c.toString(); });
          res.on("end", () => {
            clearTimeout(wallTimer);
            done(new Error(`Ollama HTTP ${res.statusCode}: ${errData.slice(0, 400)}`));
          });
          return;
        }

        // Streaming: each line is a JSON object { message: { content: "token" }, done: bool }
        let accumulated = "";
        let lineBuffer = "";

        res.on("data", (chunk: Buffer) => {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? ""; // keep incomplete line
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed) as {
                message?: { content?: string };
                done?: boolean;
                error?: string;
              };
              if (obj.error) {
                done(new Error(`Ollama error: ${obj.error}`));
                return;
              }
              accumulated += obj.message?.content ?? "";
              if (obj.done) {
                clearTimeout(wallTimer);
                const content = accumulated.trim();
                done(content || new Error("Ollama returned empty content"));
              }
            } catch {
              // Incomplete JSON line — ignore, wait for more data
            }
          }
        });

        res.on("end", () => {
          clearTimeout(wallTimer);
          // If we haven't resolved yet (e.g. done:true never came), resolve with what we have
          if (!settled) {
            done(accumulated.trim() || new Error("Ollama stream ended without content"));
          }
        });

        res.on("error", (e) => {
          clearTimeout(wallTimer);
          done(e);
        });
      }
    );

    req.on("error", (e) => {
      clearTimeout(wallTimer);
      done(e);
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Partial JSON recovery — if num_predict cut off the response mid-array,
// try to close open brackets so we can salvage the complete obligations.
// ---------------------------------------------------------------------------
function tryRecoverTruncatedJson(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    // Try as-is first
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Try to close open JSON structure
    let s = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    // Remove trailing partial object (ends with comma or incomplete key)
    s = s.replace(/,\s*\{[^}]*$/, "").replace(/,\s*"[^"]*$/, "");
    // Count open brackets and close them
    const opens = (s.match(/\{/g) ?? []).length;
    const closes = (s.match(/\}/g) ?? []).length;
    const arrOpens = (s.match(/\[/g) ?? []).length;
    const arrCloses = (s.match(/\]/g) ?? []).length;
    s += "]".repeat(Math.max(0, arrOpens - arrCloses));
    s += "}".repeat(Math.max(0, opens - closes));
    try {
      const result = JSON.parse(s) as Record<string, unknown>;
      // Only return if we got some obligations
      if (Array.isArray(result.obligations) && result.obligations.length > 0) return result;
    } catch {
      // Recovery failed
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Service options
// ---------------------------------------------------------------------------

export interface ExtractionOptions {
  /** Maximum obligations to return. @default 200 */
  maxObligations?: number;
  /** Override Ollama model. @default process.env.OLLAMA_MODEL ?? "llama3.1" */
  model?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const extractionService = {
  /**
   * Extract compliance obligations from plain regulatory document text.
   * Uses local Ollama - no API key, no rate limits, runs entirely offline.
   */
  async extractObligations(
    text: string,
    filename: string,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const model = options.model ?? DEFAULT_MODEL;
    const maxObligations = options.maxObligations ?? 200;

    const clampedText = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    // Split into chunks - 60K chars each (local model, no rate limits)
    const chunks: string[] = [];
    for (let i = 0; i < clampedText.length; i += MAX_CHARS_PER_CHUNK) {
      chunks.push(clampedText.slice(i, i + MAX_CHARS_PER_CHUNK));
    }

    const allObligations: ExtractedObligation[] = [];
    let regulation_name = filename;
    let jurisdiction = "Unknown";
    let document_summary = "";

    const chunkLimit = MAX_CHUNKS > 0 ? Math.min(chunks.length, MAX_CHUNKS) : chunks.length;
    if (MAX_CHUNKS > 0 && chunks.length > MAX_CHUNKS) {
      console.log(`[extraction] Capping at ${MAX_CHUNKS} of ${chunks.length} chunks (OLLAMA_MAX_CHUNKS)`);
    }

    for (let ci = 0; ci < chunkLimit; ci++) {
      const chunk = chunks[ci];
      const chunkNote =
        chunks.length > 1 ? `\n[Chunk ${ci + 1} of ${chunks.length}]` : "";

      const userPrompt =
        `Document filename: "${filename}"${chunkNote}\n` +
        `Analysis date: ${new Date().toISOString().split("T")[0]}\n\n` +
        `You are reviewing this document as a senior banking compliance officer preparing an obligation register for an RBI inspection.\n\n` +
        `INSTRUCTIONS:\n` +
        `1. Extract every measurable compliance obligation from the document below.\n` +
        `2. Resolve any relative deadlines to absolute dates using the circular issue date. If not visible, set deadline to null.\n` +
        `3. For each obligation, list the minimum audit evidence artefacts an RBI inspector would demand.\n` +
        `4. Sort obligations: critical -> high -> medium -> low.\n` +
        `5. Return ONLY a JSON object - no markdown fences, no prose.\n\n` +
        `=== DOCUMENT START ===\n${chunk}\n=== DOCUMENT END ===\n\n` +
        `Return a JSON object with exactly these top-level keys: ` +
        `"regulation_name", "jurisdiction", "document_summary", "obligations".`;

      const rawContent = await callOllama(model, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      let parsed: Record<string, unknown>;
      try {
        const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        // Attempt partial recovery: if JSON was truncated mid-array, try to close it
        const recovered = tryRecoverTruncatedJson(rawContent);
        if (recovered) {
          console.warn(`[extraction] Chunk ${ci + 1}: JSON truncated, recovered partial result`);
          parsed = recovered;
        } else {
          console.error(`[extraction] Chunk ${ci + 1}: invalid JSON. Preview: ${rawContent.slice(0, 200)}`);
          continue; // skip this chunk instead of failing entire extraction
        }
      }

      if (ci === 0) {
        regulation_name = String(parsed.regulation_name ?? filename).trim() || filename;
        jurisdiction = String(parsed.jurisdiction ?? "Unknown").trim();
        document_summary = String(parsed.document_summary ?? "").trim();
      }

      const rawObligations = Array.isArray(parsed.obligations)
        ? (parsed.obligations as Record<string, unknown>[])
        : [];

      const chunkObligations = rawObligations
        .filter((o) => o && typeof o === "object" && o.obligation_text)
        .map(sanitizeObligation);

      allObligations.push(...chunkObligations);
      console.log(`[extraction] Chunk ${ci + 1}/${chunkLimit}: ${chunkObligations.length} obligations (total: ${allObligations.length})`);

      if (allObligations.length >= maxObligations) break;
      // No delay between chunks - local Ollama has no rate limits
    }

    const deduped = dedupeExtractedObligations(
      allObligations,
      regulation_name,
      null,
      null,
    );
    const obligations = deduped.slice(0, maxObligations);

    return {
      obligations,
      document_summary,
      regulation_name,
      jurisdiction,
      total_found: obligations.length,
      processing_time_ms: Date.now() - startTime,
    };
  },
};
