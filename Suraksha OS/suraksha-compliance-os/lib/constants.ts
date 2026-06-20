export const siteConfig = {
  name: "Suraksha OS",
  description: "AI-Powered Compliance Operations Platform",
  tagline: "AI Compliance",
};

export const STATUS_COLORS = {
  active: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  overdue: "bg-red-500/10 text-red-400 border-red-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
} as const;

export const PRIORITY_COLORS = {
  high: "bg-red-500/10 text-red-400 border-red-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/10 text-slate-400 border-slate-500/30",
} as const;

export const CONFIDENCE_COLORS = {
  high: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  low: "text-red-400 bg-red-500/10 border-red-500/30",
} as const;

export function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 90) return "high";
  if (confidence >= 75) return "medium";
  return "low";
}
