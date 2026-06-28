"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import { toast } from "sonner";
import { Building2, Plus, Ban, Play, ChevronRight } from "lucide-react";

interface Bank {
  id: string;
  name: string;
  slug: string;
  status: string;
  region: string | null;
  manager_email: string | null;
  users: number;
  managers: number;
  departments: number;
  obligations: number;
  compliance_score: number;
}

const EMPTY_FORM = {
  name: "",
  region: "",
  license_no: "",
  manager_email: "",
  manager_password: "",
  manager_full_name: "",
};

export default function FounderOrganizationsPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await authFetch("/api/founder/banks");
      if (b.status === 403) throw new Error("Founder access required.");
      if (!b.ok) throw new Error("Failed to load banks");
      setBanks(await b.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  async function createBank(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await authFetch("/api/founder/banks", { method: "POST", body: JSON.stringify(form) });
      const body = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(body.error || "Failed");
      toast.success(`Bank "${form.name}" created`);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bank");
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(bank: Bank, status: string) {
    const res = await authFetch(
      "/api/founder/banks",
      { method: "PATCH", body: JSON.stringify({ organization_id: bank.id, status }) }
    );
    if (res.ok) {
      toast.success(`${bank.name} → ${status}`);
      load();
    } else toast.error("Update failed");
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Organizations" description="Create and manage bank tenants." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Banks on the platform. Open a tenant to view compliance modules, departments, and users."
        actions={
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Create bank
          </button>
        }
      />

      {showCreate && (
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Onboard a new bank</h3>
          <form onSubmit={createBank} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#8c90a1]">Bank name *</label>
              <Input
                value={form.name}
                onChange={set("name")}
                placeholder="HDFC Bank"
                required
                className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
              />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Region</label>
              <Input value={form.region} onChange={set("region")} placeholder="India" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">License no.</label>
              <Input
                value={form.license_no}
                onChange={set("license_no")}
                placeholder="RBI-XXXX"
                className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
              />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Manager full name</label>
              <Input
                value={form.manager_full_name}
                onChange={set("manager_full_name")}
                placeholder="Rajesh Kumar"
                className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
              />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Manager email *</label>
              <Input
                type="email"
                value={form.manager_email}
                onChange={set("manager_email")}
                placeholder="manager@hdfc.com"
                required
                className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
              />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Manager password *</label>
              <Input
                type="text"
                value={form.manager_password}
                onChange={set("manager_password")}
                placeholder="Temp password"
                required
                className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm text-[#8c90a1] hover:text-[#d4e4fa]">
                Cancel
              </button>
              <button type="submit" disabled={creating} className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60">
                {creating ? "Creating…" : "Create bank + manager"}
              </button>
            </div>
          </form>
        </GlassCard>
      )}

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-[#d4e4fa]">All banks ({banks.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#8c90a1] border-b border-white/[0.06]">
                <th className="text-left px-5 py-3">Bank</th>
                <th className="text-left px-3 py-3">Manager</th>
                <th className="text-right px-3 py-3">Users</th>
                <th className="text-right px-3 py-3">Depts</th>
                <th className="text-right px-3 py-3">Obligations</th>
                <th className="text-right px-3 py-3">Compliance</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b, i) => (
                <motion.tr
                  key={b.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-white/[0.03] hover:bg-[#273647]/15"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/founder/organizations/${b.id}`}
                      className="font-medium text-[#d4e4fa] hover:text-[#b0c6ff] inline-flex items-center gap-1"
                    >
                      {b.name}
                      <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                    </Link>
                    <span className="text-[#8c90a1] text-xs block">{b.slug}</span>
                  </td>
                  <td className="px-3 py-3 text-[#8c90a1]">{b.manager_email ?? "—"}</td>
                  <td className="px-3 py-3 text-right text-[#d4e4fa]">{b.users}</td>
                  <td className="px-3 py-3 text-right text-[#d4e4fa]">{b.departments}</td>
                  <td className="px-3 py-3 text-right text-[#d4e4fa]">{b.obligations}</td>
                  <td
                    className="px-3 py-3 text-right font-semibold"
                    style={{
                      color: b.compliance_score >= 85 ? "#4ade80" : b.compliance_score >= 70 ? "#fbbf24" : "#f87171",
                    }}
                  >
                    {b.compliance_score}%
                  </td>
                  <td className="px-3 py-3 text-center">
                    <StatusBadge
                      status={b.status}
                      variant={b.status === "active" ? "success" : b.status === "suspended" ? "error" : "default"}
                    />
                  </td>
                  <td className="px-5 py-3 text-right space-x-3">
                    <Link href={`/founder/organizations/${b.id}`} className="text-xs text-[#b0c6ff] hover:underline">
                      Open
                    </Link>
                    {b.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => setStatus(b, "suspended")}
                        className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                      >
                        <Ban className="w-3.5 h-3.5" /> Suspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setStatus(b, "active")}
                        className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        <Play className="w-3.5 h-3.5" /> Activate
                      </button>
                    )}
                  </td>
                </motion.tr>
              ))}
              {!loading && banks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-[#8c90a1]">
                    No banks yet. Create your first bank.
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
