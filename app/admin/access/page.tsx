"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { KeyRound, Plus, X } from "lucide-react";

interface OrgUser { user_id: string; email: string | null; full_name: string | null; role: string; }
interface Grant { user_id: string; permission: string; }

const GRANTABLE = [
  "documents.read", "documents.upload", "documents.delete",
  "obligations.create", "obligations.assign", "obligations.approve",
  "evidence.create", "evidence.approve", "security.findings.read",
  "reports.export", "audit.read",
];

export default function AdminAccessPage() {
  const api = useTenantApi();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selUser, setSelUser] = useState<string>("");
  const [selPerm, setSelPerm] = useState<string>(GRANTABLE[0]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [u, g] = await Promise.all([api("/api/admin/users"), api("/api/admin/permissions")]);
      if (!u.ok) { const b = await u.json().catch(() => ({})); throw new Error(b.error || "Failed"); }
      const ul: OrgUser[] = await u.json();
      setUsers(ul);
      if (ul.length && !selUser) setSelUser(ul[0].user_id);
      if (g.ok) setGrants(await g.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }, [selUser]);
  useEffect(() => { load(); }, [load]);

  const emailOf = (id: string) => users.find((u) => u.user_id === id)?.email ?? id;

  async function grant() {
    if (!selUser) return;
    setBusy(true);
    try {
      const r = await api("/api/admin/permissions", { method: "POST", body: JSON.stringify({ user_id: selUser, permission: selPerm }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Granted ${selPerm}`); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  async function revoke(g: Grant) {
    const r = await api(`/api/admin/permissions?user_id=${g.user_id}&permission=${encodeURIComponent(g.permission)}`, { method: "DELETE" });
    if (r.ok) { toast.success("Revoked"); load(); } else toast.error("Failed");
  }

  if (error) return (<div className="space-y-6"><PageHeader title="Access Control" description="Grant fine-grained permissions to users beyond their role." /><ErrorState message={error} onRetry={load} /></div>);

  return (
    <div className="space-y-6">
      <PageHeader title="Access Control" description="Grant fine-grained permissions to users beyond their role." />
      <GlassCard className="p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-[#8c90a1]">User</label>
            <select value={selUser} onChange={(e) => setSelUser(e.target.value)} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2">
              {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.email} ({u.role})</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-[#8c90a1]">Permission</label>
            <select value={selPerm} onChange={(e) => setSelPerm(e.target.value)} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2">
              {GRANTABLE.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button onClick={grant} disabled={busy || !selUser} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60"><Plus className="w-4 h-4" /> Grant</button>
        </div>
      </GlassCard>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2"><KeyRound className="w-4 h-4 text-[#b0c6ff]" /><h3 className="text-sm font-semibold text-[#d4e4fa]">Active Grants ({grants.length})</h3></div>
        <div className="divide-y divide-white/[0.04]">
          {grants.map((g, i) => (
            <div key={`${g.user_id}-${g.permission}-${i}`} className="px-5 py-3 flex items-center justify-between hover:bg-[#273647]/15">
              <div className="text-sm text-[#d4e4fa]">{emailOf(g.user_id)} <span className="text-[#8c90a1]">→</span> <span className="font-mono text-xs text-[#b0c6ff]">{g.permission}</span></div>
              <button onClick={() => revoke(g)} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /> Revoke</button>
            </div>
          ))}
          {!loading && grants.length === 0 && <div className="px-5 py-8 text-center text-[#8c90a1]">No custom grants. Users have their role permissions by default.</div>}
        </div>
      </GlassCard>
    </div>
  );
}
