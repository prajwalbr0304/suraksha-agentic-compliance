"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { HeroMetric } from "@/types";

interface GlassCardProps {
  children?: React.ReactNode;
  className?: string;
  hover?: boolean;
  style?: React.CSSProperties;
  id?: string;
}

export function GlassCard({ children, className, hover = true, style, id }: GlassCardProps) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={style}
      className={cn(
        "glass-panel rounded-xl p-4",
        hover && "glass-panel-hover transition-all duration-200",
        className
      )}
    >
      {children}
    </motion.div>
  );
}

interface KPICardProps {
  title: string;
  value: string;
  change: string;
  changeType: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  index?: number;
}

export function KPICard({ title, value, change, changeType, icon: Icon, index = 0 }: KPICardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="glass-panel glass-panel-hover rounded-xl p-5 flex flex-col justify-between h-[140px] relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 p-4 opacity-[0.06] transform translate-x-2 -translate-y-2 group-hover:scale-110 transition-transform duration-300">
        <Icon className="w-16 h-16" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
          {title}
        </p>
        <h3 className="text-3xl font-bold text-[#d4e4fa] mt-1 tracking-tight font-[Manrope]">
          {value}
        </h3>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "text-xs font-medium",
            changeType === "positive" && "text-emerald-400",
            changeType === "negative" && "text-red-400",
            changeType === "neutral" && "text-[#8c90a1]"
          )}
        >
          {change}
        </span>
      </div>
    </motion.div>
  );
}

const heroAccentClasses: Record<HeroMetric["accent"], string> = {
  neutral: "border-l-[#424655]/60",
  info: "border-l-[#b0c6ff]",
  warning: "border-l-amber-400",
  danger: "border-l-red-500",
  success: "border-l-emerald-400",
};

interface HeroMetricCardProps {
  metric: HeroMetric;
  index?: number;
}

export function HeroMetricCard({ metric, index = 0 }: HeroMetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
      className={cn(
        "glass-panel glass-panel-hover rounded-xl p-6 min-h-[160px] flex flex-col justify-between border-l-4",
        heroAccentClasses[metric.accent]
      )}
    >
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#8c90a1]">{metric.title}</p>
        <h3 className="text-4xl sm:text-5xl font-bold text-[#d4e4fa] mt-2 tracking-tight font-[Manrope] tabular-nums">
          {metric.value}
        </h3>
      </div>
      <p className="text-sm font-medium text-[#8c90a1] mt-3">{metric.subtitle}</p>
    </motion.div>
  );
}

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div>
        <h2 className="text-2xl lg:text-3xl font-bold text-[#d4e4fa] tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-[#8c90a1] mt-1">{description}</p>
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  );
}

interface StatusBadgeProps {
  status: string;
  variant?: "default" | "success" | "warning" | "error" | "info";
}

export function StatusBadge({ status, variant = "default" }: StatusBadgeProps) {
  const variants = {
    default: "bg-[#273647]/50 text-[#c2c6d8] border-[#424655]/30",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    error: "bg-red-500/10 text-red-400 border-red-500/30",
    info: "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border capitalize",
        variants[variant]
      )}
    >
      {status}
    </span>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const variant = confidence >= 90 ? "success" : confidence >= 75 ? "warning" : "error";
  const colors = {
    success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    warning: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    error: "text-red-400 bg-red-500/10 border-red-500/30",
  };
  const dotColors = {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
  };

  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium", colors[variant])}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dotColors[variant])} />
      {confidence.toFixed(1)}%
    </div>
  );
}
