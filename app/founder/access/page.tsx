"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import { KeyRound, ChevronRight } from "lucide-react";

interface Bank {
  id: string;
  name: string;
  slug: string;
}

export default function FounderAccessHubPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch("/api/founder/banks");
      if (!res.ok) throw new Error("Failed to load banks");
      setBanks(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Access control" description="Per-bank RBAC and grants." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access control"
        description="Founders do not edit daily department permissions here. Open a bank tenant to manage users, teams, and per-user grants."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {banks.map((b) => (
          <Link key={b.id} href={`/founder/organizations/${b.id}/access`}>
            <GlassCard className="p-5 flex items-center gap-4 hover:border-[#b0c6ff]/25 transition-colors h-full">
              <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-[#b0c6ff]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#d4e4fa]">{b.name}</p>
                <p className="text-xs text-[#8c90a1] truncate">{b.slug}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#8c90a1]" />
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
