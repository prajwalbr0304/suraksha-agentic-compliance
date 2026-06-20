"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type AiDecisionVariant = "detected" | "assigned";

interface AiDecisionCalloutProps {
  variant: AiDecisionVariant;
  /** When variant is "assigned", shown in the label: "Assigned to {department} because" */
  department?: string | null;
  /** Primary explanation (quote or rationale) */
  children: React.ReactNode;
  className?: string;
}

/**
 * Explainable-AI surface: short label + body for auditors / judges.
 */
export function AiDecisionCallout({ variant, department, children, className }: AiDecisionCalloutProps) {
  if (children == null || children === "") return null;

  const label =
    variant === "detected"
      ? "Detected because"
      : department?.trim()
        ? `Assigned to ${department.trim()} because`
        : "Assigned because";

  return (
    <div
      className={cn(
        "min-w-0 max-w-full rounded-lg border border-[#b0c6ff]/20 bg-[#b0c6ff]/[0.06] px-3 py-2.5",
        className
      )}
    >
      <div className="mb-1 flex items-start gap-1.5">
        <Sparkles className="w-3 h-3 text-[#b0c6ff] shrink-0" aria-hidden />
        <span className="min-w-0 text-[10px] font-semibold uppercase tracking-wider text-[#b0c6ff]/90 break-words">
          {label}
        </span>
      </div>
      <div className="min-w-0 text-sm text-[#d4e4fa]/95 leading-relaxed break-words border-l-2 border-[#b0c6ff]/35 pl-2.5">
        {children}
      </div>
    </div>
  );
}
