"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";

interface Dept {
  id: string;
  name: string;
  head: string | null;
  email: string | null;
  risk_level: string;
}
const EMPTY = { name: "", head: "", email: "", risk_level: "medium" };

export default function AdminDepartmentsPage() {
  const api = useTenantApi();
  const [items, setItems] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editDept, setEditDept] = useState<Dept | null>(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [deleteDept, setDeleteDept] = useState<Dept | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api("/api/admin/departments");
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || "Failed");
      }
      setItems(await r.json());
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
    if (editDept) {
      setEditForm({
        name: editDept.name,
        head: editDept.head ?? "",
        email: editDept.email ?? "",
        risk_level: editDept.risk_level || "medium",
      });
    }
  }, [editDept]);

  const setCreate = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const setEdit = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm((p) => ({ ...p, [k]: e.target.value }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/admin/departments", { method: "POST", body: JSON.stringify(form) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Department ${form.name} created`);
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
    if (!editDept) return;
    const name = editForm.name.trim();
    if (!name) {
      toast.error("Department name is required.");
      return;
    }
    setBusy(true);
    try {
      const r = await api(`/api/admin/departments/${editDept.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          head: editForm.head.trim() || null,
          email: editForm.email.trim() || null,
          risk_level: editForm.risk_level,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Department ${name} updated`);
      setEditDept(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteDept) return;
    setBusy(true);
    try {
      const r = await api(`/api/admin/departments/${deleteDept.id}`, { method: "DELETE" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "Failed");
      toast.success(`Removed ${deleteDept.name}`);
      setDeleteDept(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) return (<div className="space-y-6"><PageHeader title="Departments" description="Create and manage departments within your bank." /><ErrorState message={error} onRetry={load} /></div>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Create and manage departments within your bank."
        actions={
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Department
          </button>
        }
      />
      {showCreate && (
        <GlassCard className="p-6">
          <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#8c90a1]">Name *</label>
              <Input value={form.name} onChange={setCreate("name")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Head</label>
              <Input value={form.head} onChange={setCreate("head")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Email</label>
              <Input value={form.email} onChange={setCreate("email")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Risk Level</label>
              <select
                value={form.risk_level}
                onChange={setCreate("risk_level")}
                className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#8c90a1]">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60">
                {busy ? "…" : "Create"}
              </button>
            </div>
          </form>
        </GlassCard>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((d) => (
          <GlassCard key={d.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#d4e4fa] pr-2">{d.name}</h3>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title="Edit department"
                  onClick={() => setEditDept(d)}
                  className="p-1.5 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/50 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Remove department"
                  onClick={() => setDeleteDept(d)}
                  className="p-1.5 rounded-lg text-[#8c90a1] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end mt-2">
              <StatusBadge
                status={d.risk_level}
                variant={d.risk_level === "high" ? "error" : d.risk_level === "medium" ? "warning" : "success"}
              />
            </div>
            <p className="text-xs text-[#8c90a1] mt-2">{d.head || "No head assigned"}</p>
            <p className="text-xs text-[#8c90a1]">{d.email || "—"}</p>
          </GlassCard>
        ))}
        {!loading && items.length === 0 && (
          <GlassCard className="p-8 text-center text-[#8c90a1] md:col-span-3">No departments yet.</GlassCard>
        )}
      </div>

      {editDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-lg p-6 relative border border-white/[0.1]">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 text-[#8c90a1] hover:text-[#d4e4fa]"
              onClick={() => setEditDept(null)}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Edit department</h3>
            <form onSubmit={saveEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-xs text-[#8c90a1]">Name *</label>
                <Input value={editForm.name} onChange={setEdit("name")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
              </div>
              <div>
                <label className="text-xs text-[#8c90a1]">Head</label>
                <Input value={editForm.head} onChange={setEdit("head")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
              </div>
              <div>
                <label className="text-xs text-[#8c90a1]">Email</label>
                <Input value={editForm.email} onChange={setEdit("email")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-[#8c90a1]">Risk Level</label>
                <select
                  value={editForm.risk_level}
                  onChange={setEdit("risk_level")}
                  className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditDept(null)} className="px-4 py-2 text-sm text-[#8c90a1]">
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

      {deleteDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-md p-6 border border-white/[0.1]">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Remove department?</h3>
            <p className="text-sm text-[#8c90a1] mt-2">
              Delete <span className="text-[#d4e4fa] font-medium">{deleteDept.name}</span>? This cannot be undone. You cannot remove a
              department while active users are still assigned to it.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setDeleteDept(null)} className="px-4 py-2 text-sm text-[#8c90a1]">
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
