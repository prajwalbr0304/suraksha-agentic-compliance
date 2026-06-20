"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UsersRound, X } from "lucide-react";

interface Team {
  id: string;
  name: string;
  department_id: string | null;
}
interface Dept {
  id: string;
  name: string;
}
const EMPTY = { name: "", department_id: "" };

export default function AdminTeamsPage() {
  const api = useTenantApi();
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, d] = await Promise.all([api("/api/admin/teams"), api("/api/admin/departments")]);
      if (!t.ok) {
        const b = await t.json().catch(() => ({}));
        throw new Error(b.error || "Failed");
      }
      setTeams(await t.json());
      if (d.ok) setDepts(await d.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (editTeam) {
      setEditForm({
        name: editTeam.name,
        department_id: editTeam.department_id ?? "",
      });
    }
  }, [editTeam]);

  const deptName = (id: string | null) => depts.find((x) => x.id === id)?.name ?? "—";
  const setCreate = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));
  const setEdit = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm((p) => ({ ...p, [k]: e.target.value }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/admin/teams", {
        method: "POST",
        body: JSON.stringify({ name: form.name, department_id: form.department_id || null }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Team ${form.name} created`);
      setForm(EMPTY);
      setShowCreate(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTeam) return;
    const name = editForm.name.trim();
    if (!name) {
      toast.error("Team name is required.");
      return;
    }
    setBusy(true);
    try {
      const r = await api(`/api/admin/teams/${editTeam.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          department_id: editForm.department_id || null,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Team ${name} updated`);
      setEditTeam(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTeam) return;
    setBusy(true);
    try {
      const r = await api(`/api/admin/teams/${deleteTeam.id}`, { method: "DELETE" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Removed ${deleteTeam.name}`);
      setDeleteTeam(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Teams" description="Organize users into teams under departments." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        description="Organize users into teams under departments."
        actions={
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Team
          </button>
        }
      />
      {showCreate && (
        <GlassCard className="p-6">
          <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#8c90a1]">Team Name *</label>
              <Input value={form.name} onChange={setCreate("name")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Department</label>
              <select
                value={form.department_id}
                onChange={setCreate("department_id")}
                className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
              >
                <option value="">(none)</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#8c90a1]">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60"
              >
                {busy ? "…" : "Create"}
              </button>
            </div>
          </form>
        </GlassCard>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map((t) => (
          <GlassCard key={t.id} className="p-5 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#273647]/40 flex items-center justify-center shrink-0">
              <UsersRound className="w-4 h-4 text-[#b0c6ff]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#d4e4fa] pr-2">{t.name}</h3>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Edit team"
                    onClick={() => setEditTeam(t)}
                    className="p-1.5 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/50 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Remove team"
                    onClick={() => setDeleteTeam(t)}
                    className="p-1.5 rounded-lg text-[#8c90a1] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#8c90a1] mt-1">{deptName(t.department_id)}</p>
            </div>
          </GlassCard>
        ))}
        {!loading && teams.length === 0 && (
          <GlassCard className="p-8 text-center text-[#8c90a1] md:col-span-3">No teams yet.</GlassCard>
        )}
      </div>

      {editTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-lg p-6 relative border border-white/[0.1]">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 text-[#8c90a1] hover:text-[#d4e4fa]"
              onClick={() => setEditTeam(null)}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Edit team</h3>
            <form onSubmit={saveEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-xs text-[#8c90a1]">Team Name *</label>
                <Input value={editForm.name} onChange={setEdit("name")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-[#8c90a1]">Department</label>
                <select
                  value={editForm.department_id}
                  onChange={setEdit("department_id")}
                  className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
                >
                  <option value="">(none)</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditTeam(null)} className="px-4 py-2 text-sm text-[#8c90a1]">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </GlassCard>
        </div>
      )}

      {deleteTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-md p-6 border border-white/[0.1]">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Remove team?</h3>
            <p className="text-sm text-[#8c90a1] mt-2">
              Delete <span className="text-[#d4e4fa] font-medium">{deleteTeam.name}</span>? This cannot be undone. You cannot remove a team
              while active users are still assigned to it.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setDeleteTeam(null)} className="px-4 py-2 text-sm text-[#8c90a1]">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmDelete}
                className="px-5 py-2 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 disabled:opacity-60"
              >
                {busy ? "Removing…" : "Remove"}
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
