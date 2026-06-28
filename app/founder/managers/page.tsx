"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";

interface Bank {
  id: string;
  name: string;
  manager_email: string | null;
}

export default function FounderManagersPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/founder/banks");
      if (!res.ok) throw new Error("Failed to load banks");
      const data = (await res.json()) as Bank[];
      setBanks(data.filter((b) => b.manager_email));
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
        <PageHeader title="Managers" description="Bank manager contacts across tenants." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Managers" description="Primary bank manager email registered for each organization." />

      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#8c90a1] border-b border-white/[0.06]">
                <th className="text-left px-5 py-3">Bank</th>
                <th className="text-left px-3 py-3">Manager email</th>
                <th className="text-left px-5 py-3">Tenant</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b, i) => (
                <motion.tr key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-white/[0.03]">
                  <td className="px-5 py-3 text-[#d4e4fa] font-medium">{b.name}</td>
                  <td className="px-3 py-3 text-[#8c90a1]">{b.manager_email}</td>
                  <td className="px-5 py-3">
                    <Link href={`/founder/organizations/${b.id}`} className="text-xs text-[#b0c6ff] hover:underline">
                      Open bank workspace
                    </Link>
                  </td>
                </motion.tr>
              ))}
              {!loading && banks.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-[#8c90a1]">
                    No manager emails on file.
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
