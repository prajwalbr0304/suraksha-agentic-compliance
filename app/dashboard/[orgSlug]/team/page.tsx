"use client";

import { useCallback, useEffect, useState } from "react";
import { GlassCard, PageHeader, StatusBadge } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import { supabase } from "@/lib/supabase/client";
import { Scale, Clock, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

interface AssignedObligation {
  id: string;
  title: string;
  department: string;
  status: string;
  priority: string;
  due_date: string;
}

export default function TeamDashboardPage() {
  const [obligations, setObligations] = useState<AssignedObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      setUserEmail(s.session?.user.email ?? "");
      const res = await authFetch("/api/obligations");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setObligations(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load obligations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const dueThisWeek = obligations.filter(o => {
    const due = new Date(o.due_date);
    const now = new Date();
    const diff = (due.getTime() - now.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  });
  const overdue = obligations.filter(o => o.status === "overdue");
  const compliant = obligations.filter(o => o.status === "compliant");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Owner Dashboard"
        description={`Assigned obligations and evidence tasks${userEmail ? ` for ${userEmail}` : ""}.`}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          { label: "Assigned Tasks", value: obligations.length, icon: Scale, color: "text-[#b0c6ff]", bg: "bg-[#b0c6ff]/10" },
          { label: "Due This Week", value: dueThisWeek.length, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Overdue", value: overdue.length, icon: Clock, color: "text-red-400", bg: "bg-red-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <GlassCard key={label} className="p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#d4e4fa]">{value}</p>
              <p className="text-xs text-[#8c90a1]">{label}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#d4e4fa]">My Obligations</h3>
          <Link href="/obligations" className="text-xs text-[#b0c6ff] hover:underline">View all →</Link>
        </div>
        {loading && <div className="p-6 text-sm text-[#8c90a1] animate-pulse">Loading obligations…</div>}
        {error && <ErrorState message={error} onRetry={loadData} />}
        {!loading && !error && obligations.length === 0 && (
          <div className="p-8 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm text-[#8c90a1]">No obligations assigned to your department.</p>
          </div>
        )}
        <div className="divide-y divide-white/[0.04]">
          {obligations.slice(0, 15).map((obl, i) => (
            <motion.div key={obl.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="px-5 py-3.5 flex items-center gap-4 hover:bg-[#273647]/20">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#d4e4fa] truncate">{obl.title}</p>
                <p className="text-xs text-[#8c90a1]">{obl.department} · Due {obl.due_date}</p>
              </div>
              <StatusBadge status={obl.status} variant={obl.status === "overdue" ? "error" : obl.status === "compliant" ? "success" : "warning"} />
              <StatusBadge status={obl.priority} variant={obl.priority === "critical" ? "error" : obl.priority === "high" ? "warning" : "default"} />
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
