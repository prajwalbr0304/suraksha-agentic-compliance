"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import {
  Building2,
  Users,
  ShieldCheck,
  Crown,
  Bot,
  Activity,
  ArrowRight,
  BarChart3,
  FileBarChart,
  ScrollText,
} from "lucide-react";

interface Overview {
  total_banks: number;
  active_banks: number;
  suspended_banks: number;
  total_users: number;
  total_founders: number;
  total_obligations: number;
  total_maps?: number;
  platform_compliance_score: number;
}

interface AgentHealth {
  status: string;
  llm_configured?: boolean;
  model?: string;
  scheduler?: boolean;
}

interface BankRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  compliance_score: number;
  open_obligations: number;
  pending_evidence: number;
  drift_alerts: number;
  total_maps: number;
  total_users: number;
}

export default function FounderDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null);
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, h, a] = await Promise.all([
        authFetch("/api/founder/overview"),
        authFetch("/api/agents/status").catch(() => null as unknown as Response),
        authFetch("/api/founder/analytics").catch(() => null as unknown as Response),
      ]);
      if (o.status === 403) throw new Error("Founder access required.");
      if (!o.ok) throw new Error("Failed to load platform overview");
      setOverview(await o.json());
      if (h?.ok) {
        const body = await h.json();
        setAgentHealth(body.health ?? null);
      } else {
        setAgentHealth(null);
      }
      if (a?.ok) {
        const body = await a.json();
        setBanks(Array.isArray(body.banks) ? body.banks : []);
      } else {
        setBanks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Founder Dashboard" description="Platform-wide metrics and adoption signals." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const kpis = overview
    ? [
        { label: "Total banks", value: overview.total_banks, icon: Building2, color: "text-[#b0c6ff]" },
        { label: "Active banks", value: overview.active_banks, icon: ShieldCheck, color: "text-emerald-400" },
        { label: "Total users", value: overview.total_users, icon: Users, color: "text-amber-400" },
        { label: "Total MAPs", value: overview.total_maps ?? 0, icon: Activity, color: "text-cyan-400" },
        { label: "Platform obligations", value: overview.total_obligations, icon: Activity, color: "text-cyan-400" },
        {
          label: "Compliance adoption (avg.)",
          value: `${overview.platform_compliance_score}%`,
          icon: Crown,
          color: "text-purple-400",
        },
      ]
    : [];

  const agentOk = agentHealth?.status === "ok";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Founder Dashboard"
        description="Monitor banks, users, agent health, and compliance adoption across the Suraksha platform."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <GlassCard key={label} className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center">
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#d4e4fa]">{loading ? "…" : value}</p>
              <p className="text-xs text-[#8c90a1]">{label}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard className="p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center shrink-0">
            <Bot className={`w-5 h-5 ${agentOk ? "text-emerald-400" : "text-amber-400"}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#d4e4fa]">Agent service</p>
            <p className="text-xs text-[#8c90a1] mt-1">
              {agentOk
                ? `Online · ${agentHealth?.model ?? "Gemini"} · scheduler ${agentHealth?.scheduler ? "on" : "off"}`
                : "Unreachable or not configured — start the Python agent-service and set AGENT_SERVICE_URL."}
            </p>
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-[#b0c6ff] hover:underline"
            >
              Open agents <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="text-sm font-semibold text-[#d4e4fa] mb-3">Quick navigation</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { href: "/founder/organizations", label: "Organizations", icon: Building2 },
              { href: "/founder/managers", label: "Managers", icon: Users },
              { href: "/founder/users", label: "All users", icon: Users },
              { href: "/analytics", label: "Analytics", icon: BarChart3 },
              { href: "/reports", label: "Reports", icon: FileBarChart },
              { href: "/audit", label: "Audit trail", icon: ScrollText },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#051424]/40 px-3 py-2 text-sm text-[#d4e4fa] hover:border-[#b0c6ff]/30 hover:bg-[#273647]/30 transition-colors"
              >
                <Icon className="w-4 h-4 text-[#b0c6ff]" />
                {label}
                <ArrowRight className="w-3 h-3 ml-auto text-[#8c90a1]" />
              </Link>
            ))}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[#b0c6ff]" />
          <h3 className="text-sm font-semibold text-[#d4e4fa]">Per-bank compliance breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#8c90a1] border-b border-white/[0.06]">
                <th className="text-left px-5 py-3">Bank</th>
                <th className="text-center px-3 py-3">Compliance</th>
                <th className="text-center px-3 py-3">Open obligations</th>
                <th className="text-center px-3 py-3">Pending evidence</th>
                <th className="text-center px-3 py-3">Drift alerts</th>
                <th className="text-center px-3 py-3">MAPs</th>
                <th className="text-right px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b) => {
                const scoreColor = b.compliance_score >= 85 ? "text-emerald-400" : b.compliance_score >= 60 ? "text-amber-400" : "text-red-400";
                return (
                  <tr key={b.id} className="border-b border-white/[0.03] hover:bg-[#273647]/15">
                    <td className="px-5 py-3 text-[#d4e4fa] font-medium">{b.name}</td>
                    <td className={`px-3 py-3 text-center font-semibold ${scoreColor}`}>{b.compliance_score}%</td>
                    <td className="px-3 py-3 text-center text-[#d4e4fa]">{b.open_obligations}</td>
                    <td className="px-3 py-3 text-center text-[#d4e4fa]">{b.pending_evidence}</td>
                    <td className="px-3 py-3 text-center text-[#d4e4fa]">{b.drift_alerts}</td>
                    <td className="px-3 py-3 text-center text-[#8c90a1]">{b.total_maps}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/founder/organizations/${b.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#b0c6ff] hover:underline">
                        Open <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!loading && banks.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-[#8c90a1]">No banks yet. Create one under Organizations.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-[#5a637a]">
        Day-to-day compliance work (documents, MAPs, evidence) lives under each bank:{" "}
        <Link href="/founder/organizations" className="text-[#b0c6ff] hover:underline">
          Organizations
        </Link>{" "}
        → select a bank.
      </motion.div>
    </div>
  );
}
