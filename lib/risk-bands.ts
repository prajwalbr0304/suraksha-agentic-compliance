import type { RiskScore } from "@/types";

/** Higher score = healthier department. Map to operational risk for UX labels. */
export function scoreToOperationalRiskBand(score: number): RiskScore["riskBand"] {
  if (score < 50) return "high";
  if (score < 70) return "medium";
  return "low";
}
