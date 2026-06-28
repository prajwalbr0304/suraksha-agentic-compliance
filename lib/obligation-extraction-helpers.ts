/**
 * Server-only helpers: department routing, obligation fingerprinting, dedupe.
 * Used by extraction.service and extraction-persistence.service.
 */

import { createHash } from "node:crypto";
import type { ExtractedObligation } from "@/types/extraction";

/** Must stay in sync with SYSTEM_PROMPT department list in extraction.service.ts */
export const ALLOWED_DEPARTMENTS = [
  "Legal",
  "Finance",
  "IT",
  "Operations",
  "HR",
  "Risk Management",
  "Compliance",
  "Internal Audit",
  "Treasury",
  "Customer Service",
  "Fraud & AML",
  "Credit",
] as const;

const ALLOWED_SET = new Set<string>(ALLOWED_DEPARTMENTS);

/** Map common model typos / aliases to canonical names */
const DEPARTMENT_ALIASES: Record<string, string> = {
  "risk": "Risk Management",
  "risk mgmt": "Risk Management",
  "risk management department": "Risk Management",
  "information technology": "IT",
  "information technology (it)": "IT",
  "technology": "IT",
  "cyber security": "IT",
  "cybersecurity": "IT",
  "audit": "Internal Audit",
  "internal audit department": "Internal Audit",
  "aml": "Fraud & AML",
  "anti-money laundering": "Fraud & AML",
  "lending": "Credit",
  "loan": "Credit",
  "credit risk": "Credit",
  "treasury department": "Treasury",
};

function normalizeWhitespace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeForFingerprint(text: string): string {
  return normalizeWhitespace(text)
    .replace(/[^a-z0-9\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);
}

export function computeObligationFingerprint(parts: {
  organizationId?: string | null;
  documentId?: string | null;
  regulationName: string;
  obligationText: string;
}): string {
  const org = (parts.organizationId ?? "").trim();
  const doc = (parts.documentId ?? "").trim();
  const reg = normalizeWhitespace(parts.regulationName).slice(0, 200);
  const body = normalizeForFingerprint(parts.obligationText);
  const key = `${org}|${doc}|${reg}|${body}`;
  return createHash("sha256").update(key, "utf8").digest("hex");
}

type Rule = { dept: (typeof ALLOWED_DEPARTMENTS)[number]; test: (t: string) => boolean };

const ROUTING_RULES: Rule[] = [
  {
    dept: "Fraud & AML",
    test: (t) =>
      /\b(aml|pmla|kyc|cdd|edd|fiu|money laundering|terrorist financing|sanction)\b/i.test(t),
  },
  {
    dept: "IT",
    test: (t) =>
      /\b(it governance|information technology|cyber|vapt|soc\b|ransomware|data centre|datacenter|core banking system|software asset|digital banking platform)\b/i.test(
        t,
      ),
  },
  {
    dept: "Treasury",
    test: (t) =>
      /\b(treasury|liquidity coverage|lcr\b|nsfr|alco|market risk in the trading book|investment portfolio valuation)\b/i.test(
        t,
      ),
  },
  {
    dept: "Credit",
    test: (t) =>
      /\b(npa|non[- ]performing|loan classification|asset classification|provisioning|risk weight|standardised approach|credit exposure|lending|advances|consumer credit|retail portfolio|commercial banks\b|nbfc)\b/i.test(
        t,
      ),
  },
  {
    dept: "Risk Management",
    test: (t) =>
      /\b(model risk|model validation|model inventory|model performance|stress test|icaap|enterprise risk|erm\b|macroprudential|macroeconomic variables|irrbb|interest rate risk in the banking book)\b/i.test(
        t,
      ),
  },
  {
    dept: "Operations",
    test: (t) =>
      /\b(operational resilience|outsourcing|business continuity|bcp|disaster recovery|branch operations|process re[- ]engineering)\b/i.test(
        t,
      ),
  },
  {
    dept: "Legal",
    test: (t) =>
      /\b(board resolution|companies act|contractual|litigation|legal opinion|statutory filing other than rbi returns)\b/i.test(
        t,
      ),
  },
  {
    dept: "Finance",
    test: (t) =>
      /\b(financial reporting|ind as|accounting policy|capital adequacy disclosure|dividend distribution policy)\b/i.test(
        t,
      ),
  },
  {
    dept: "HR",
    test: (t) =>
      /\b(hr policy|human resources|staff training|code of conduct for employees|whistle[- ]blower)\b/i.test(t),
  },
  {
    dept: "Customer Service",
    test: (t) =>
      /\b(customer grievance|ombudsman|fair practices code|mis[- ]selling|conduct risk toward customers)\b/i.test(
        t,
      ),
  },
  {
    dept: "Internal Audit",
    test: (t) =>
      /\b(internal audit|audit committee|independent assurance)\b/i.test(t) &&
      !/\b(rbi inspection|statutory audit)\b/i.test(t),
  },
];

/**
 * Pick owning department from obligation language when the model defaults to Compliance.
 */
export function inferDepartmentFromText(obligationText: string, citation: string): string {
  const t = `${obligationText}\n${citation}`;
  for (const rule of ROUTING_RULES) {
    if (rule.test(t)) return rule.dept;
  }
  return "Compliance";
}

export function canonicalizeDepartment(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (ALLOWED_SET.has(s)) return s;
  const key = normalizeWhitespace(s);
  const alias = DEPARTMENT_ALIASES[key];
  if (alias && ALLOWED_SET.has(alias)) return alias;
  const lower = key;
  for (const d of ALLOWED_DEPARTMENTS) {
    if (lower === d.toLowerCase()) return d;
  }
  return null;
}

/**
 * Combine model output with keyword routing. Prefer a valid model department when
 * it is not the generic default; otherwise infer from text.
 */
export function resolveDepartment(rawDepartment: unknown, obligationText: string, citation: string): string {
  const inferred = inferDepartmentFromText(obligationText, citation);
  const stated = canonicalizeDepartment(rawDepartment);
  if (!stated) return inferred;

  // Small models often emit "Compliance" for everything — override when routing is confident.
  if (stated === "Compliance" && inferred !== "Compliance") return inferred;

  return stated;
}

/**
 * Drop duplicate obligations from the same extraction (overlapping chunks / model repeats).
 * Keeps the row with higher confidence; tie-breaker: longer text.
 */
export function dedupeExtractedObligations(
  obligations: ExtractedObligation[],
  regulationName: string,
  organizationId?: string | null,
  documentId?: string | null,
): ExtractedObligation[] {
  const best = new Map<string, ExtractedObligation>();

  for (const o of obligations) {
    const fp = computeObligationFingerprint({
      organizationId,
      documentId,
      regulationName,
      obligationText: o.obligation_text,
    });
    const prev = best.get(fp);
    if (!prev) {
      best.set(fp, o);
      continue;
    }
    const score = (x: ExtractedObligation) => x.confidence * 1000 + x.obligation_text.length;
    if (score(o) > score(prev)) best.set(fp, o);
  }

  return [...best.values()];
}
