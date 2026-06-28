"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";

interface Row {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string | null;
  organization_name: string;
  organization_id: string;
}

export default function FounderUsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/founder/platform-users");
      if (!res.ok) throw new Error("Failed to load users");
      setRows(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
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
        <PageHeader title="Users" description="All members across bank tenants." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Cross-tenant directory of organization members (platform view)." />

      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#8c90a1] border-b border-white/[0.06]">
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-3 py-3">Name</th>
                <th className="text-left px-3 py-3">Role</th>
                <th className="text-left px-3 py-3">Bank</th>
                <th className="text-right px-5 py-3">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <motion.tr key={`${r.user_id}-${r.organization_id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.01 }} className="border-b border-white/[0.03]">
                  <td className="px-5 py-2.5 text-[#d4e4fa]">{r.email}</td>
                  <td className="px-3 py-2.5 text-[#8c90a1]">{r.full_name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[#8c90a1]">{r.role}</td>
                  <td className="px-3 py-2.5 text-[#d4e4fa]">{r.organization_name}</td>
                  <td className="px-5 py-2.5 text-right">
                    <Link href={`/founder/organizations/${r.organization_id}/users`} className="text-xs text-[#b0c6ff] hover:underline">
                      Manage in bank
                    </Link>
                  </td>
                </motion.tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[#8c90a1]">
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
