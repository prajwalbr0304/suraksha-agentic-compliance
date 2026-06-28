"use client";

import { GlassCard, PageHeader, StatusBadge } from "@/components/ui/glass-card";

interface PersonaDashboardProps {
  title: string;
  description: string;
  focus: string[];
  metrics: Array<{ label: string; value: string; status: "healthy" | "warning" | "critical" | "neutral" }>;
}

export function PersonaDashboard({ title, description, focus, metrics }: PersonaDashboardProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {metrics.map((metric) => (
          <GlassCard key={metric.label} className="p-5">
            <p className="text-xs uppercase tracking-[0.08em] text-[#8c90a1]">{metric.label}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-3xl font-bold text-[#d4e4fa]">{metric.value}</span>
              <StatusBadge
                status={metric.status === "neutral" ? "tracking" : metric.status}
                variant={metric.status === "critical" ? "error" : metric.status === "warning" ? "warning" : "success"}
              />
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold text-[#d4e4fa] mb-4">Persona Focus</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {focus.map((item) => (
            <div key={item} className="rounded-lg border border-[#424655]/20 bg-[#0d1c2d]/50 px-4 py-3 text-sm text-[#d4e4fa]">
              {item}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
